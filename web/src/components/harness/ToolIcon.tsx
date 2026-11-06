import {
  Code2,
  FileText,
  FolderOpen,
  Globe,
  Images,
  List,
  Network,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { toolGlyph } from "./toolRowModel";
export function ToolIcon({ item }: { item?: Record<string, any> }) {
  const Icon = {
    command: TerminalSquare,
    read: FileText,
    list: FolderOpen,
    search: Search,
    files: FileText,
    image: Images,
    tool: Wrench,
    output: List,
    code: Code2,
    web: Globe,
    integration: Network,
  }[toolGlyph(item)];
  return <Icon size={14} aria-hidden="true" />;
}
