import type { PromptDocument } from "./promptText";

/** The agent prompt and the editable Markdown document are separate native paths. */
export interface ComposerDocument {
  markdown: string;
  document: PromptDocument;
}
export interface ComposerSubmission {
  text: string;
  composer: ComposerDocument;
  goal?: boolean;
}
