/** Portable working state; native position and machine edge zones are deliberately absent. */
export type HugescreenState = {
  widthMultiplier: number;
  heightMultiplier: number;
  panMode: "continuous" | "edge";
  enabled: boolean;
};
