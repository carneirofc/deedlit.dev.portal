import type { LocalServiceApp } from "@/features/services/types";

/**
 * Development fallback for the service list.
 *
 * In the cluster the portal discovers these from Kubernetes Ingress objects
 * (see `../server/discover.ts`). This copy exists so `npm run dev:dev` renders
 * something realistic on a laptop, where there is no ServiceAccount token.
 *
 * These mirror the charts in `deedlit.dev.infra/apps/`. There are no
 * `probeUrl`s: nothing here is reachable from outside the cluster, so every
 * card renders with an "unknown" health state rather than a misleading red.
 */
export const localServiceApps: LocalServiceApp[] = [
  {
    id: "pgadmin",
    name: "pgAdmin",
    host: "pgadmin.deedlit.dev",
    url: "https://pgadmin.deedlit.dev",
    description: "PostgreSQL administration console.",
    category: "ops",
    icon: "database",
    order: 10
  },
  {
    id: "rustfs-console",
    name: "RustFS Console",
    host: "rustfs.deedlit.dev",
    url: "https://rustfs.deedlit.dev",
    description: "Object storage browser and bucket administration.",
    category: "storage",
    icon: "files",
    order: 20
  },
  {
    id: "rustfs-s3",
    name: "RustFS S3 API",
    host: "s3.deedlit.dev",
    url: "https://s3.deedlit.dev",
    description: "S3-compatible endpoint backing the image library.",
    category: "storage",
    icon: "storage",
    order: 21
  },
  {
    id: "zot",
    name: "Container Registry",
    host: "registry.deedlit.dev",
    url: "https://registry.deedlit.dev",
    description: "Private OCI registry for images built outside the cluster.",
    category: "ops",
    icon: "registry",
    order: 30
  },
  {
    id: "keycloak",
    name: "Keycloak",
    host: "auth.deedlit.dev",
    url: "https://auth.deedlit.dev",
    description: "Identity provider (OIDC).",
    category: "auth",
    icon: "idp",
    order: 40
  },
  {
    id: "bookorbit",
    name: "BookOrbit",
    host: "books.deedlit.dev",
    url: "https://books.deedlit.dev",
    description: "Ebook and audiobook library.",
    category: "media",
    icon: "books",
    order: 50
  },
  {
    id: "readest",
    name: "Readest",
    host: "readest.deedlit.dev",
    url: "https://readest.deedlit.dev",
    description: "Ebook reader, storing files in RustFS.",
    category: "media",
    icon: "books",
    order: 51
  }
];
