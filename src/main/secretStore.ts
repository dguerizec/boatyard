const fs = require("node:fs");
const path = require("node:path");

type StoredPasswordCredential = {
  encryptedPassword: string;
  username: string;
};

type SecretState = {
  passwordVault: Record<string, StoredPasswordCredential>;
};

function normalizeCredential(value: unknown): StoredPasswordCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const username = String(source.username || "").trim();
  const encryptedPassword = String(source.encryptedPassword || "").trim();
  return username && encryptedPassword ? { username, encryptedPassword } : null;
}

class SecretStore {
  private readonly filePath: string;
  private state: SecretState = { passwordVault: {} };

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      const passwordVault = source.passwordVault && typeof source.passwordVault === "object" && !Array.isArray(source.passwordVault)
        ? source.passwordVault as Record<string, unknown>
        : {};
      this.state.passwordVault = Object.fromEntries(
        Object.entries(passwordVault).flatMap(([origin, credential]) => {
          const normalized = normalizeCredential(credential);
          return normalized ? [[String(origin), normalized]] : [];
        })
      );
    } catch (error) {
      console.warn(`Could not load Boatyard secrets: ${(error as Error).message}`);
    }
  }

  getPasswordCredential(origin: string): StoredPasswordCredential | null {
    const credential = this.state.passwordVault[origin];
    return credential ? { ...credential } : null;
  }

  importPasswordVault(passwordVault: unknown): void {
    if (!passwordVault || typeof passwordVault !== "object" || Array.isArray(passwordVault)) {
      return;
    }
    let changed = false;
    for (const [origin, credential] of Object.entries(passwordVault)) {
      const normalized = normalizeCredential(credential);
      if (normalized && !this.state.passwordVault[origin]) {
        this.state.passwordVault[origin] = normalized;
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  updatePasswordCredential(origin: string, credential: StoredPasswordCredential): void {
    this.state.passwordVault[origin] = { ...credential };
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }
}

module.exports = { SecretStore };

export {};
