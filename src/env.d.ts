/// <reference types="vite/client" />
declare module "virtual:camellia-content" {
  const content: import("./core/types.ts").GameContent;
  export default content;
  export const migrationReleases: import("./core/types.ts").GameContent[];
}
