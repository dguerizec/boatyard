import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalizeDirectory } from "./launchDescriptor.js";
import { normalizeSlug } from "./storeUtils.js";

const text = (maximum: number) => z.string().max(maximum).trim().min(1)
  .regex(/^[^\u0000-\u001f\u007f]+$/, "Control characters are not allowed");
const relativeDirectory = text(2048).regex(/^(?!\.{1,2}(?:\/|$))[^/\\:]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\:]+){0,15}$/,
  "directory must contain at most 16 child segments without dot traversal");

export const createProjectInputSchema = z.strictObject({
  contextId: z.string().regex(/^[a-f0-9]{16}$/).describe("Opaque configuration context ID returned by list_windows"),
  name: text(160),
  directory: relativeDirectory.describe("Relative child directory inside configured projectsBasePath; missing directories are created"),
  reuse: z.boolean().optional().describe("Defaults to false. Set true to allow creating the project in an existing directory"),
  slug: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional()
    .describe("Canonical slug; defaults to the domain slug derived from name"),
  group: text(160).optional(),
  createTwiccProject: z.union([z.boolean(), z.literal("auto")]).optional()
    .describe("Defaults to auto: create a trusted TwiCC project only when the TwiCC plugin is enabled, propagating trust to descendants")
});

const rejectionCodes = [
  "INVALID_PROJECT_INPUT", "CONTEXT_NOT_AVAILABLE", "PROJECT_READ_FAILED",
  "PROJECTS_ROOT_NOT_AVAILABLE", "DIRECTORY_NOT_AVAILABLE", "DIRECTORY_OUTSIDE_PROJECTS_ROOT", "DIRECTORY_ALREADY_EXISTS",
  "DUPLICATE_PROJECT_SLUG", "DUPLICATE_PROJECT_NAME", "DUPLICATE_SOURCE_PATH",
  "TWICC_NOT_AVAILABLE", "TWICC_NAME_TOO_LONG", "PROJECT_CREATION_UNAVAILABLE"
] as const;
const partialCodes = ["DIRECTORY_CREATION_UNCERTAIN", "TWICC_CREATION_UNCERTAIN", "TWICC_LINK_UNCERTAIN", "TWICC_LINK_CHANGED"] as const;
const directoryReceiptSchema = z.strictObject({
  status: z.enum(["not_attempted", "existing", "created", "unknown"]), createdCount: z.number().int().min(0).max(16)
});
const twiccReceiptSchema = z.strictObject({
  status: z.enum(["not_attempted", "skipped", "created", "unknown"]),
  attemptedCount: z.number().int().min(0).max(1), confirmedCount: z.number().int().min(0).max(1),
  projectId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/).optional()
});
const projectSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(160), slug: z.string().min(1).max(80),
  group: z.string().max(160), isOpen: z.literal(true)
});
const receipts = { directory: directoryReceiptSchema, twicc: twiccReceiptSchema };
const completed = {
  contextId: z.string().regex(/^[a-f0-9]{16}$/), project: projectSchema,
  attemptedCount: z.literal(1), confirmedCount: z.literal(1), ...receipts
};
export const createProjectOutputSchema = z.union([
  z.strictObject({ status: z.literal("created"), ...completed }),
  z.strictObject({ status: z.literal("rejected"), code: z.enum(rejectionCodes),
    attemptedCount: z.literal(0), confirmedCount: z.literal(0), ...receipts }),
  z.strictObject({ status: z.literal("unknown"), code: z.literal("PROJECT_CREATION_UNCERTAIN"),
    attemptedCount: z.literal(1), confirmedCount: z.literal(0), ...receipts }),
  z.strictObject({ status: z.literal("partial"), code: z.enum(partialCodes),
    contextId: z.string().regex(/^[a-f0-9]{16}$/), project: projectSchema.optional(),
    attemptedCount: z.number().int().min(0).max(1), confirmedCount: z.number().int().min(0).max(1), ...receipts })
]);

export type ProjectCreationReceipt = z.infer<typeof createProjectOutputSchema>;
type DirectoryReceipt = z.infer<typeof directoryReceiptSchema>;
type ProjectIdentity = { id?: string; name?: string; slug?: string; sourcePath?: string; group?: string; isOpen?: boolean };
type CreationState = {
  projects: ProjectIdentity[];
  settings?: { projectsBasePath?: unknown };
  pluginConfig?: { projects?: Record<string, Record<string, Record<string, unknown>>> };
};
export type ProjectCreationStore = {
  getState(): CreationState;
  addProject(values: unknown): unknown;
  updateProjectPluginConfig(projectId: string, pluginId: string, values: unknown): unknown;
};
export type ProjectCreationContext = {
  store: ProjectCreationStore;
  twiccEnabled: boolean;
  createTwiccProject(values: {
    name: string; sourcePath: string; trust: true; propagateTrust: true; allowCliFallback: false
  }): Promise<unknown>;
};
const notAttemptedTwicc = () => ({ status: "not_attempted" as const, attemptedCount: 0, confirmedCount: 0 });
export function rejectProjectCreation(code: typeof rejectionCodes[number]): ProjectCreationReceipt {
  return { status: "rejected", code, attemptedCount: 0, confirmedCount: 0,
    directory: { status: "not_attempted", createdCount: 0 }, twicc: notAttemptedTwicc() };
}
export function uncertainProjectCreation(directory: DirectoryReceipt = { status: "unknown", createdCount: 0 }): ProjectCreationReceipt {
  return { status: "unknown", code: "PROJECT_CREATION_UNCERTAIN", attemptedCount: 1, confirmedCount: 0,
    directory, twicc: notAttemptedTwicc() };
}
function isChild(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function createMcpProject(
  input: unknown,
  resolveContext: (contextId: string) => ProjectCreationContext | undefined
): Promise<ProjectCreationReceipt> {
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) return rejectProjectCreation("INVALID_PROJECT_INPUT");
  const { contextId, directory, reuse = false, createTwiccProject = "auto", ...values } = parsed.data;
  let slug: string;
  try { slug = normalizeSlug(values.slug, values.name); }
  catch { return rejectProjectCreation("INVALID_PROJECT_INPUT"); }
  if (slug.length > 80) return rejectProjectCreation("INVALID_PROJECT_INPUT");
  let context: ProjectCreationContext;
  let state: CreationState;
  try {
    const resolved = resolveContext(contextId);
    if (!resolved) return rejectProjectCreation("CONTEXT_NOT_AVAILABLE");
    context = resolved;
    state = context.store.getState();
    if (state.projects.some((project) => project.slug === slug)) return rejectProjectCreation("DUPLICATE_PROJECT_SLUG");
    const foldedName = (name: string) => name.trim().normalize("NFKC").toLowerCase();
    if (state.projects.some((project) => foldedName(project.name || "") === foldedName(values.name))) {
      return rejectProjectCreation("DUPLICATE_PROJECT_NAME");
    }
  } catch { return rejectProjectCreation("PROJECT_READ_FAILED"); }
  const wantsTwicc = createTwiccProject === "auto" ? context.twiccEnabled : createTwiccProject;
  if (wantsTwicc && !context.twiccEnabled) return rejectProjectCreation("TWICC_NOT_AVAILABLE");
  // TwiCC's project domain accepts at most 25 Unicode code points. Refuse the
  // known backend validation failure before creating local files or a project.
  if (wantsTwicc && [...values.name].length > 25) return rejectProjectCreation("TWICC_NAME_TOO_LONG");
  let root: string;
  try {
    const configured = state.settings?.projectsBasePath;
    if (typeof configured !== "string" || !path.isAbsolute(configured) || !fs.statSync(configured).isDirectory()) {
      return rejectProjectCreation("PROJECTS_ROOT_NOT_AVAILABLE");
    }
    root = fs.realpathSync.native(configured);
    if (root === path.parse(root).root) return rejectProjectCreation("PROJECTS_ROOT_NOT_AVAILABLE");
  } catch { return rejectProjectCreation("PROJECTS_ROOT_NOT_AVAILABLE"); }
  let sourcePath: string;
  try {
    sourcePath = canonicalizeDirectory(path.resolve(root, directory));
    if (!isChild(root, sourcePath)) return rejectProjectCreation("DIRECTORY_OUTSIDE_PROJECTS_ROOT");
    if (fs.existsSync(sourcePath) && !reuse) return rejectProjectCreation("DIRECTORY_ALREADY_EXISTS");
    if (state.projects.some((project) => project.sourcePath && path.isAbsolute(project.sourcePath) &&
      canonicalizeDirectory(project.sourcePath) === sourcePath)) return rejectProjectCreation("DUPLICATE_SOURCE_PATH");
  } catch { return rejectProjectCreation("DIRECTORY_NOT_AVAILABLE"); }
  const directoryReceipt: DirectoryReceipt = { status: "existing", createdCount: 0 };
  // All preflight checks run before mkdir or addProject; neither yields here.
  // Recheck each directory against the canonical root while creating children.
  try {
    let current = root;
    for (const segment of path.relative(root, sourcePath).split(path.sep)) {
      current = path.join(current, segment);
      if (fs.existsSync(current)) {
        if (current === sourcePath && !reuse) throw new Error("Project directory appeared during creation");
      } else {
        fs.mkdirSync(current);
        directoryReceipt.createdCount += 1;
        directoryReceipt.status = "created";
      }
      if (!fs.statSync(current).isDirectory() || !isChild(root, fs.realpathSync.native(current))) {
        throw new Error("Project directory changed during creation");
      }
    }
  } catch {
    return { status: "partial", code: "DIRECTORY_CREATION_UNCERTAIN", contextId,
      attemptedCount: 0, confirmedCount: 0, directory: { ...directoryReceipt, status: "unknown" }, twicc: notAttemptedTwicc() };
  }
  const previousIds = new Set(state.projects.map((project) => project.id));
  let project: z.infer<typeof projectSchema>;
  try {
    const next = context.store.addProject({ ...values, slug, sourcePath }) as CreationState;
    const added = next.projects.filter((candidate) => !previousIds.has(candidate.id));
    if (added.length !== 1) return uncertainProjectCreation(directoryReceipt);
    const created = added[0];
    project = projectSchema.parse({ id: created.id, name: created.name, slug: created.slug, group: created.group, isOpen: created.isOpen });
  } catch { return uncertainProjectCreation(directoryReceipt); }
  const base = { contextId, project, attemptedCount: 1 as const, confirmedCount: 1 as const, directory: directoryReceipt };
  if (!wantsTwicc) return { status: "created", ...base, twicc: { status: "skipped", attemptedCount: 0, confirmedCount: 0 } };
  let twiccProject: { id: string; url: string };
  try {
    const result = await context.createTwiccProject({
      name: values.name, sourcePath, trust: true, propagateTrust: true, allowCliFallback: false
    });
    const reply = z.object({ id: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/), url: z.string().max(2048), matchType: z.literal("exact") }).parse(result);
    const url = new URL(reply.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid TwiCC link");
    twiccProject = reply;
  } catch {
    return { status: "partial", code: "TWICC_CREATION_UNCERTAIN", ...base,
      twicc: { status: "unknown", attemptedCount: 1, confirmedCount: 0 } };
  }
  const twicc = { status: "created" as const, projectId: twiccProject.id, attemptedCount: 1, confirmedCount: 1 };
  try {
    const fresh = context.store.getState();
    const target = fresh.projects.find((candidate) => candidate.id === project.id);
    if (!target || target.sourcePath !== sourcePath || fresh.pluginConfig?.projects?.[project.id]?.["boatyard.twicc"]?.twiccProjectUrl) {
      return { status: "partial", code: "TWICC_LINK_CHANGED", ...base, twicc };
    }
    context.store.updateProjectPluginConfig(project.id, "boatyard.twicc", { twiccProjectUrl: twiccProject.url });
  } catch { return { status: "partial", code: "TWICC_LINK_UNCERTAIN", ...base, twicc }; }
  return { status: "created", ...base, twicc };
}
