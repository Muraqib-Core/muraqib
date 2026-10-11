/**
 * Typed content model for the documentation Web View.
 *
 * The page text lives in plain data (these types), never in HTML, so a tab can be edited or
 * added without touching markup, and a translated `PageContent` can be rendered unchanged.
 * Inline text supports only `code`, **bold** and [label](https://url); everything is escaped.
 */

/** Reading direction of a content set; `rtl` is reserved for the future Arabic content. */
export type TextDirection = "ltr" | "rtl";

/** Visual weight of a callout box. */
export type CalloutTone = "info" | "tip" | "warning";

export interface HeadingBlock {
  kind: "heading";
  level: 2 | 3;
  text: string;
}

export interface ParagraphBlock {
  kind: "paragraph";
  text: string;
}

export interface ListBlock {
  kind: "list";
  items: string[];
}

export interface CodeBlock {
  kind: "code";
  language: string;
  code: string;
}

export interface TableBlock {
  kind: "table";
  headers: string[];
  rows: string[][];
}

export interface CalloutBlock {
  kind: "callout";
  tone: CalloutTone;
  text: string;
}

export interface Card {
  title: string;
  body: string;
  /** Short labels rendered as chips (module names, flags, severities). */
  tags?: string[];
}

export interface CardsBlock {
  kind: "cards";
  cards: Card[];
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CodeBlock
  | TableBlock
  | CalloutBlock
  | CardsBlock;

export interface TabContent {
  /** Lowercase slug; used for element ids and the URL hash (`#features`). */
  id: string;
  title: string;
  blocks: Block[];
}

export interface SidebarItem {
  label: string;
  value: string;
  /** Absolute http(s) URL; the value is rendered as a link when present. */
  href?: string;
}

export interface SidebarGroup {
  title: string;
  items: SidebarItem[];
}

/** Every user-facing string that is not part of a tab, so a translation can replace them all. */
export interface UiLabels {
  copy: string;
  copied: string;
  tabsLabel: string;
  skipToContent: string;
}

export interface PageContent {
  /** BCP 47 language tag for the `<html lang>` attribute. */
  lang: string;
  dir: TextDirection;
  name: string;
  tagline: string;
  version: string;
  badges: string[];
  labels: UiLabels;
  tabs: TabContent[];
  sidebar: SidebarGroup[];
}
