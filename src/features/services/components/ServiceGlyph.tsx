import {
  FiImage,
  FiMessageSquare,
  FiBarChart2,
  FiShare2,
  FiSearch,
  FiFolder,
  FiLock,
  FiDatabase,
  FiHardDrive,
  FiPackage,
  FiBookOpen,
  FiBox
} from "react-icons/fi";
import type { ServiceIcon } from "@/features/services/types";

const GLYPHS: Record<ServiceIcon, React.ComponentType<{ className?: string }>> = {
  gallery: FiImage,
  prompt: FiMessageSquare,
  metrics: FiBarChart2,
  comfyui: FiShare2,
  searnime: FiSearch,
  files: FiFolder,
  idp: FiLock,
  database: FiDatabase,
  storage: FiHardDrive,
  registry: FiPackage,
  books: FiBookOpen,
  generic: FiBox
};

/**
 * Icons come from an annotation, so an unrecognized value must still render
 * something — `generic` is the fallback rather than a blank card.
 */
export function ServiceGlyph({ icon }: { icon: ServiceIcon }) {
  const Glyph = GLYPHS[icon] ?? FiBox;
  return <Glyph className="h-5 w-5" aria-hidden />;
}
