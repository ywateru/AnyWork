import {
  Fragment,
  NodeRange,
  Slice,
  type MarkType,
  type Node as PMNode,
  type NodeType,
  type Schema,
} from "prosemirror-model";
import {
  EditorState,
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import {
  chainCommands,
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  splitListItem,
  wrapInList,
  wrapRangeInList,
} from "prosemirror-schema-list";
import {
  canJoin,
  canSplit,
  liftTarget,
  ReplaceAroundStep,
  ReplaceStep,
} from "prosemirror-transform";

// Behavioral reconstruction of the static iga/uMn/Tac contract. Reference code
// is never imported or evaluated. Node names intentionally follow its schema.
const isItem = (type: NodeType) => type.isInGroup("list_item");
export function richListItem(
  state: EditorState,
): { node: PMNode; depth: number } | null {
  for (let depth = state.selection.$from.depth; depth > 0; depth--) {
    const node = state.selection.$from.node(depth);
    if (node.type.spec.tableRole === "cell") return null;
    if (isItem(node.type)) return { node, depth };
  }
  return null;
}

/** Enter's non-submit task path preserves marks and resets the new checkbox. */
export const richListNewline: Command = (state, dispatch, view) => {
  const item = richListItem(state);
  if (!item) return false;
  if (item.node.type.name !== "task_list_item")
    return splitListItem(item.node.type)(state, dispatch, view);
  const keepMarksDispatch =
    dispatch &&
    ((tr: Transaction) => {
      const { $from } = tr.selection;
      if (
        $from.depth >= 2 &&
        $from.node(-1).type.name === "task_list_item" &&
        $from.node(-1).attrs.checked === true
      )
        tr.setNodeMarkup($from.before(-1), undefined, {
          ...$from.node(-1).attrs,
          checked: false,
        });
      const marks =
        state.storedMarks ??
        (state.selection.$to.parentOffset
          ? state.selection.$from.marks()
          : null);
      if (marks) tr.ensureMarks(marks);
      dispatch(tr);
    });
  return chainCommands(splitListItem(item.node.type), lift)(
    state,
    keepMarksDispatch,
    view,
  );
};

/** Shift Enter always splits tasks; regular lists split in desktop Enter mode. */
export function richShiftNewline(splitRegular: boolean): Command {
  return (state, dispatch, view) => {
    const item = richListItem(state);
    if (!item) return false;
    const firstItemStart =
      state.selection.$from.parentOffset === 0 &&
      state.selection.$from.index(-1) === 0;
    return item.node.type.name === "task_list_item" ||
      splitRegular ||
      firstItemStart
      ? splitListItem(item.node.type)(state, dispatch, view)
      : false;
  };
}
export const richAltNewline: Command = (state, dispatch, view) => {
  const item = richListItem(state);
  return item?.node.type.name === "regular_list_item"
    ? splitListItem(item.node.type)(state, dispatch, view)
    : false;
};

function itemRange(tr: Transaction) {
  const { $from, $to } = tr.selection;
  const range = $from.blockRange(
    $to,
    (node) => node.firstChild != null && isItem(node.firstChild.type),
  );
  if (!range) return null;
  for (let depth = $from.depth; depth > range.depth; depth--)
    if ($from.node(depth).type.spec.tableRole === "cell") return null;
  return range;
}

function sinkItems(tr: Transaction): boolean {
  let range = itemRange(tr);
  if (!range) return false;
  // A split list immediately following an existing compatible list can rejoin.
  if (range.startIndex === 0) {
    const before = range.$from.before(range.depth);
    if (
      tr.doc.resolve(before).nodeBefore?.type === range.parent.type &&
      canJoin(tr.doc, before)
    ) {
      tr.join(before);
      range = itemRange(tr);
    }
  }
  if (!range || range.startIndex === 0) return false;
  const previous = range.parent.child(range.startIndex - 1);
  if (!isItem(previous.type)) return false;
  const item = range.parent.child(range.startIndex);
  const nested = previous.lastChild?.type === range.parent.type;
  const inner = Fragment.from(nested ? item.type.create() : null);
  const slice = new Slice(
    Fragment.from(
      item.type.create(
        null,
        Fragment.from(range.parent.type.create(null, inner)),
      ),
    ),
    nested ? 3 : 1,
    0,
  );
  tr.step(
    new ReplaceAroundStep(
      range.start - (nested ? 3 : 1),
      range.end,
      range.start,
      range.end,
      slice,
      1,
      true,
    ),
  );
  return true;
}

function liftOutOfList(tr: Transaction, range: NodeRange): boolean {
  const list = range.parent;
  const mapIndex = tr.mapping.maps.length;
  for (
    let end = range.end, index = range.endIndex - 1;
    index > range.startIndex;
    index--
  ) {
    end -= list.child(index).nodeSize;
    tr.delete(end - 1, end + 1);
  }
  const $start = tr.doc.resolve(range.start),
    item = $start.nodeAfter;
  if (
    !item ||
    tr.mapping.slice(mapIndex).map(range.end) !== range.start + item.nodeSize
  )
    return false;
  const atStart = range.startIndex === 0,
    atEnd = range.endIndex === list.childCount;
  const parent = $start.node(-1),
    index = $start.index(-1);
  if (
    !parent.canReplace(
      index + (atStart ? 0 : 1),
      index + 1,
      item.content.append(atEnd ? Fragment.empty : Fragment.from(list)),
    )
  )
    return false;
  const start = $start.pos,
    end = start + item.nodeSize;
  tr.step(
    new ReplaceAroundStep(
      start - Number(atStart),
      end + Number(atEnd),
      start + 1,
      end - 1,
      new Slice(
        (atStart
          ? Fragment.empty
          : Fragment.from(list.copy(Fragment.empty))
        ).append(
          atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)),
        ),
        Number(!atStart),
        Number(!atEnd),
      ),
      Number(!atStart),
    ),
  );
  return true;
}
function liftItems(tr: Transaction): boolean {
  let range = itemRange(tr);
  if (!range || range.depth < 1) return false;
  if (!isItem(range.$from.node(range.depth - 1).type))
    return liftOutOfList(tr, range);
  const mapIndex = tr.mapping.maps.length,
    end = range.end,
    listEnd = range.$to.end(range.depth);
  if (end < listEnd) {
    const lastItemType = range.parent.child(range.endIndex - 1).type;
    tr.step(
      new ReplaceAroundStep(
        end - 1,
        listEnd,
        end,
        listEnd,
        new Slice(
          Fragment.from(lastItemType.create(null, range.parent.copy())),
          1,
          0,
        ),
        1,
        true,
      ),
    );
    range = new NodeRange(
      tr.doc.resolve(range.$from.pos),
      tr.doc.resolve(listEnd),
      range.depth,
    );
  }
  const target = liftTarget(range);
  if (target == null) return false;
  tr.lift(range, target);
  const $after = tr.doc.resolve(tr.mapping.slice(mapIndex).map(end, -1) - 1);
  if (
    canJoin(tr.doc, $after.pos) &&
    $after.nodeBefore?.type === $after.nodeAfter?.type
  )
    tr.join($after.pos);
  return true;
}
function listIndent(outdent: boolean): Command {
  return (state, dispatch) => {
    const tr = state.tr,
      original = state.selection;
    if (original instanceof TextSelection) {
      if (!(outdent ? liftItems(tr) : sinkItems(tr))) return false;
    } else {
      for (const { $from, $to } of [...original.ranges].reverse()) {
        tr.setSelection(
          TextSelection.between(
            tr.doc.resolve(tr.mapping.map($from.pos, 1)),
            tr.doc.resolve(tr.mapping.map($to.pos, -1)),
          ),
        );
        if (!(outdent ? liftItems(tr) : sinkItems(tr))) return false;
      }
      tr.setSelection(original.getBookmark().map(tr.mapping).resolve(tr.doc));
    }
    if (state.storedMarks) tr.ensureMarks(state.storedMarks);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Tac's code Tab is reached after the earlier list Tab plugin. */
export function richTab(outdent: boolean): Command {
  return (state, dispatch, view) => {
    if (!state.schema.nodes.heading) return false;
    const { $from, $to, empty } = state.selection;
    if ($from.parent.type.name === "code_block" && $from.sameParent($to)) {
      const value = $from.parent.textContent;
      const last =
        !empty && value[$to.parentOffset - 1] === "\n"
          ? $to.parentOffset - 1
          : $to.parentOffset;
      const first =
        $from.parentOffset === 0
          ? 0
          : value.lastIndexOf("\n", $from.parentOffset - 1) + 1;
      const starts = [first];
      for (
        let index = value.indexOf("\n", first);
        index !== -1 && index + 1 <= last;
        index = value.indexOf("\n", index + 1)
      )
        starts.push(index + 1);
      const tr = state.tr;
      for (const offset of starts.reverse()) {
        const position = $from.start() + offset;
        if (!outdent) tr.insertText("\t", position);
        else {
          const source = state.doc.textBetween(
            position,
            Math.min(position + 4, $from.end()),
          );
          const count = source.startsWith("\t")
            ? 1
            : (source.match(/^ {1,4}/)?.[0].length ?? 0);
          if (count) tr.delete(position, position + count);
        }
      }
      if (!outdent || tr.docChanged) dispatch?.(tr);
      return true;
    }
    if ($from.parent.type.name === "heading") {
      const level = $from.parent.attrs.level + (outdent ? -1 : 1);
      if (level < 0 || level > 6) return false;
      return setBlockType(
        level ? state.schema.nodes.heading : state.schema.nodes.paragraph,
        level ? { level } : undefined,
      )(state, dispatch, view);
    }
    return false;
  };
}

const escapedTail = (value: string) =>
  (value.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
function markRule(
  pattern: RegExp,
  mark: MarkType,
  offsetGroup = 0,
  textGroup = 1,
  trailingGroup = 2,
): InputRule {
  return new InputRule(
    pattern,
    (state, original, start, end) => {
      if (!(state.selection instanceof TextSelection)) return null;
      let match = original,
        position = start + (offsetGroup ? match[offsetGroup].length : 0);
      while (
        escapedTail(
          state.doc
            .resolve(position)
            .parent.textBetween(
              0,
              state.doc.resolve(position).parentOffset,
              undefined,
              "\ufffc",
            ),
        )
      ) {
        const skip = (offsetGroup ? match[offsetGroup].length : 0) + 1;
        const retry = pattern.exec(match[0].slice(skip));
        if (!retry) return null;
        start += skip + retry.index;
        match = retry;
        position = start + (offsetGroup ? match[offsetGroup].length : 0);
        if (position > state.selection.from) return null;
      }
      const text = match[textGroup],
        code = state.schema.marks.code;
      if (
        typeof text !== "string" ||
        !state.doc.resolve(position).parent.type.allowsMarkType(mark)
      )
        return null;
      if (
        mark !== code &&
        ((code && state.doc.rangeHasMark(position, end, code)) ||
          escapedTail(text))
      )
        return null;
      const preserved = [
        ...(state.doc.nodeAt(position)?.marks ?? []),
        mark.create(),
      ];
      const tr = state.tr.replaceWith(position, end, state.schema.text(text));
      for (const active of preserved) {
        tr.addMark(position, position + text.length, active);
        tr.removeStoredMark(active);
      }
      return tr.insertText(match[trailingGroup] ?? "");
    },
    { inCodeMark: false },
  );
}

function taskRule(schema: Schema): InputRule {
  return new InputRule(
    /^\s{0,3}(?:[-+*]\s)?\[([ xX]?)\]\s$/,
    (state, match, start, end) => {
      const checked = match[1].toLowerCase() === "x",
        type = schema.nodes.task_list_item;
      const tr = state.tr.delete(start, end);
      let $from = tr.selection.$from;
      if (!isItem($from.node(-1).type)) {
        const range = $from.blockRange(tr.selection.$to);
        if (!range || !wrapRangeInList(tr, range, schema.nodes.list))
          return null;
      } else if ($from.index(-1) > 0) {
        const position = $from.before(),
          types = [{ type, attrs: { checked } }];
        return canSplit(tr.doc, position, 1, types)
          ? tr.split(position, 1, types)
          : null;
      }
      $from = tr.selection.$from;
      const item = $from.node(-1);
      return isItem(item.type)
        ? tr.setNodeMarkup($from.before(-1), type, { ...item.attrs, checked })
        : null;
    },
    { inCodeMark: false },
  );
}

function buildRules(schema: Schema): InputRule[] {
  if (!schema.nodes.heading) return [];
  const prefix = String.raw`(?:^|[\s\p{Ps}\p{Pi}"'])(?:\*+|_+|~~)?`;
  const rules: InputRule[] = [
    markRule(
      new RegExp(
        `(${prefix})\x60([^\\s\x60](?:[^\x60\\r\\n]*[^\\s\x60])?)\x60([^\x60])?$`,
        "u",
      ),
      schema.marks.code,
      1,
      2,
      3,
    ),
    textblockTypeInputRule(
      /^\s{0,3}(#{1,6})\s$/,
      schema.nodes.heading,
      (match) => ({ level: match[1].length }),
    ),
    wrappingInputRule(/^\s{0,3}>\s$/, schema.nodes.blockquote),
    wrappingInputRule(
      /^\s{0,3}(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (match) => ({ startingNumber: +match[1] }),
      (match, node) =>
        node.childCount + node.attrs.startingNumber === +match[1],
    ),
    wrappingInputRule(/^\s{0,3}([-+*])\s$/, schema.nodes.list),
    taskRule(schema),
    textblockTypeInputRule(/^\s{0,3}```$/, schema.nodes.code_block),
    new InputRule(/```$/, (state, _match, start, end) => {
      const { $from, empty } = state.selection;
      if (
        !empty ||
        $from.depth !== 1 ||
        $from.parent.type !== schema.nodes.paragraph ||
        $from.parentOffset !== $from.parent.content.size
      )
        return null;
      const tr = state.tr.delete(start, end),
        after = tr.mapping.map($from.after());
      tr.insert(after, schema.nodes.code_block.create());
      return tr
        .setSelection(TextSelection.create(tr.doc, after + 1))
        .scrollIntoView();
    }),
    markRule(/\*\*([^\s](?:.*[^\s])?)\*\*([\s\S])$/, schema.marks.strong),
    markRule(
      /(^|[^\w_])__([^\s_](?:.*[^\s_])?)__([^\w_])$/,
      schema.marks.strong,
      1,
      2,
      3,
    ),
    markRule(
      /(^|[^*])\*([^\s*](?:.*[^\s*])?)\*([^*])$/,
      schema.marks.em,
      1,
      2,
      3,
    ),
    markRule(
      /(^|[^\w_]|(?:^|[^\w_])__[^_\s]*)_([^\s_](?:.*[^\s_])?)_([^\w_])$/,
      schema.marks.em,
      1,
      2,
      3,
    ),
    markRule(
      /~([^\s~](?:[^~\r\n]*[^\s~])?)~([^~])$/,
      schema.marks.strikethrough,
    ),
    markRule(/~~([^\s](?:.*[^\s])?)~~([\s\S])$/, schema.marks.strikethrough),
    new InputRule(
      /^ {0,3}(?:\*\*\*|---|___)\n$/,
      (state, match, start, end) => {
        const $start = state.doc.resolve(start);
        if (
          !state.selection.empty ||
          end - start !== match[0].length - 1 ||
          $start.parent.type !== schema.nodes.paragraph ||
          start !== $start.start() ||
          end !== $start.end() ||
          state.doc.rangeHasMark(start, end, schema.marks.code)
        )
          return null;
        const replacement = Fragment.fromArray([
          schema.nodes.horizontal_rule.create(),
          schema.nodes.paragraph.create(),
        ]);
        if (
          !$start
            .node(-1)
            .canReplace($start.index(-1), $start.index(-1) + 1, replacement)
        )
          return null;
        const tr = state.tr.replaceWith(
          $start.before(),
          $start.after(),
          replacement,
        );
        return tr.setSelection(
          TextSelection.create(tr.doc, $start.before() + 2),
        );
      },
    ),
  ];
  return rules;
}

const activeCodeMark = (state: EditorState) => {
  const code = state.schema.marks.code;
  return (
    code != null &&
    !!code.isInSet(state.storedMarks ?? state.selection.$from.marks())
  );
};

export function richCodeArrow(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    if ($from.parent.type.name === "code_block") {
      const text = $from.parent.textContent,
        offset = $from.parentOffset;
      const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
      const nextLF = text.indexOf("\n", lineStart),
        lineEnd = nextLF < 0 ? text.length : nextLF;
      if (offset === lineEnd) {
        if (direction === -1 && lineStart > 0) {
          dispatch?.(
            state.tr
              .setSelection(
                TextSelection.create(state.doc, $from.start() + lineStart - 1),
              )
              .scrollIntoView(),
          );
          return true;
        }
        if (direction === 1) {
          if (nextLF >= 0) {
            const nextEnd = text.indexOf("\n", nextLF + 1);
            dispatch?.(
              state.tr
                .setSelection(
                  TextSelection.create(
                    state.doc,
                    $from.start() + (nextEnd < 0 ? text.length : nextEnd),
                  ),
                )
                .scrollIntoView(),
            );
            return true;
          }
          const after = $from.after(),
            tr =
              state.doc.nodeAt(after)?.type === state.schema.nodes.paragraph
                ? state.tr
                : state.tr.insert(after, state.schema.nodes.paragraph.create());
          dispatch?.(
            tr
              .setSelection(TextSelection.create(tr.doc, after + 1))
              .scrollIntoView(),
          );
          return true;
        }
      }
      if (!view?.endOfTextblock?.(direction === -1 ? "up" : "down", state))
        return false;
      const boundary = direction === -1 ? $from.before() : $from.after();
      const selection = Selection.findFrom(
        state.doc.resolve(boundary),
        direction,
        true,
      );
      const tr = state.tr;
      if (selection) tr.setSelection(selection);
      else {
        tr.insert(boundary, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
      }
      dispatch?.(tr.scrollIntoView());
      return true;
    }
    if (
      direction === -1 &&
      $from.depth === 1 &&
      $from.parent.type === state.schema.nodes.paragraph &&
      $from.index(0) > 0 &&
      state.doc.child($from.index(0) - 1).type.name === "code_block" &&
      view?.endOfTextblock?.("up", state)
    ) {
      dispatch?.(
        state.tr
          .setSelection(TextSelection.create(state.doc, $from.before() - 1))
          .scrollIntoView(),
      );
      return true;
    }
    return false;
  };
}

function flattenLists(tr: Transaction): boolean {
  for (let count = 0; count <= tr.doc.content.size; count++) {
    if (!itemRange(tr)) return true;
    if (!liftItems(tr)) return false;
  }
  return false;
}
function blockStyle(type: NodeType, attrs?: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const tr = state.tr,
      marks = state.storedMarks;
    if (!flattenLists(tr)) return false;
    tr.setBlockType(tr.selection.from, tr.selection.to, type, attrs);
    if (marks) tr.ensureMarks(marks);
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
function listStyle(type: NodeType): Command {
  return (state, dispatch, view) => {
    const current = richListItem(state),
      tr = state.tr,
      marks = state.storedMarks;
    if (
      current?.node.type.name === "task_list_item" &&
      state.selection.$from.node(current.depth - 1).type === type
    ) {
      tr.setNodeMarkup(
        state.selection.$from.before(current.depth),
        state.schema.nodes.regular_list_item,
        current.node.attrs,
      );
    } else {
      let sameList = false;
      for (let depth = state.selection.$from.depth; depth > 0; depth--)
        if (state.selection.$from.node(depth).type === type) sameList = true;
      if (!flattenLists(tr)) return false;
      if (!sameList || current?.node.type.name === "task_list_item") {
        tr.setBlockType(
          tr.selection.from,
          tr.selection.to,
          state.schema.nodes.paragraph,
        );
        const intermediate = state.apply(tr);
        let wrapped: Transaction | undefined;
        if (
          !wrapInList(type)(
            intermediate,
            (next) => {
              wrapped = next;
            },
            view,
          )
        )
          return false;
        for (const step of wrapped!.steps) tr.step(step);
        if (wrapped!.selectionSet) tr.setSelection(wrapped!.selection);
      }
    }
    if (marks) tr.ensureMarks(marks);
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

type TypedCell = { from: number; to: number; escaped: number[]; text: string };
function typedCells(value: string): TypedCell[] | null {
  const first = value.length - value.trimStart().length,
    last = value.trimEnd().length;
  if (value[first] !== "|" || value[last - 1] !== "|" || last - first < 2)
    return null;
  const result: TypedCell[] = [];
  let start = first + 1,
    escaped: number[] = [];
  const append = (end: number) => {
    const raw = value.slice(start, end),
      text = raw.trim();
    const from = text ? start + raw.indexOf(text) : end,
      to = from + text.length;
    const offsets = escaped
      .filter((offset) => offset >= from && offset < to)
      .map((offset) => offset - from);
    const set = new Set(offsets);
    result.push({
      from,
      to,
      escaped: offsets,
      text: text
        .split("")
        .filter((_character, index) => !set.has(index))
        .join(""),
    });
  };
  for (let index = start; index < last - 1; index++) {
    if (value[index] === "\\" && value[index + 1] === "|") {
      escaped.push(index);
      index++;
    } else if (value[index] === "|") {
      append(index);
      start = index + 1;
      escaped = [];
    }
  }
  append(last - 1);
  return result.length >= 2 ? result : null;
}
/** Three top-level pipe paragraphs become a two-row table on Enter. */
export const richTypedTable: Command = (state, dispatch) => {
  const { $from, empty } = state.selection,
    schema = state.schema;
  if (
    !empty ||
    $from.depth !== 1 ||
    $from.parent.type !== schema.nodes.paragraph ||
    $from.parentOffset !== $from.parent.content.size ||
    $from.index(0) < 2
  )
    return false;
  const index = $from.index(0),
    header = state.doc.child(index - 2),
    separator = state.doc.child(index - 1),
    body = state.doc.child(index);
  if (
    ![header, separator, body].every((node) => {
      let valid = node.type === schema.nodes.paragraph;
      node.forEach((child) => {
        if (!child.isText) valid = false;
      });
      return valid;
    })
  )
    return false;
  const headCells = typedCells(header.textContent),
    separatorCells = typedCells(separator.textContent),
    bodyCells = typedCells(body.textContent);
  if (
    !headCells ||
    !separatorCells ||
    !bodyCells ||
    headCells.length !== separatorCells.length ||
    headCells.length !== bodyCells.length ||
    !separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.text))
  )
    return false;
  const aligns = separatorCells.map((cell) =>
    cell.text.startsWith(":")
      ? cell.text.endsWith(":")
        ? "center"
        : "left"
      : cell.text.endsWith(":")
        ? "right"
        : null,
  );
  const row = (paragraph: PMNode, cells: TypedCell[], rowIndex: number) =>
    schema.nodes.table_row.create(
      null,
      cells.map((cell, column) => {
        const source = paragraph.content.cut(cell.from, cell.to);
        let content = Fragment.empty,
          start = 0;
        for (const offset of cell.escaped) {
          content = content.append(source.cut(start, offset));
          start = offset + 1;
        }
        content = content.append(source.cut(start));
        return schema.nodes.table_cell.create(
          { rowIndex, colspan: 1, rowspan: 1, align: aligns[column] },
          content,
        );
      }),
    );
  const table = schema.nodes.table.create(null, [
    row(header, headCells, 0),
    row(body, bodyCells, 1),
  ]);
  let start = 0;
  for (let before = 0; before < index - 2; before++)
    start += state.doc.child(before).nodeSize;
  const tr = state.tr.replaceWith(
    start,
    start + header.nodeSize + separator.nodeSize + body.nodeSize,
    Fragment.fromArray([table, schema.nodes.paragraph.create()]),
  );
  tr.setSelection(
    Selection.findFrom(tr.doc.resolve(start + table.nodeSize), 1, true)!,
  );
  dispatch?.(tr.scrollIntoView());
  return true;
};

export function richInputKeymap(schema: Schema): Record<string, Command> {
  if (!schema.nodes.heading) return {};
  const result: Record<string, Command> = {
    ArrowUp: richCodeArrow(-1),
    ArrowDown: richCodeArrow(1),
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    "Mod-Shift-x": toggleMark(schema.marks.strikethrough),
    "Mod-Shift-X": toggleMark(schema.marks.strikethrough),
    "Ctrl-`": toggleMark(schema.marks.code),
    "Alt-Mod-0": blockStyle(schema.nodes.paragraph),
    "Shift-Mod-7": listStyle(schema.nodes.ordered_list),
    "Alt-Mod-4": listStyle(schema.nodes.ordered_list),
    "Shift-Mod-8": listStyle(schema.nodes.list),
    "Alt-Mod-5": listStyle(schema.nodes.list),
    "Mod->": wrapIn(schema.nodes.blockquote),
    "Mod-_": (state, dispatch) => {
      dispatch?.(
        state.tr
          .replaceSelectionWith(schema.nodes.horizontal_rule.create())
          .scrollIntoView(),
      );
      return true;
    },
  };
  for (let level = 1; level <= 6; level++)
    result[`Shift-Mod-${level}`] = setBlockType(schema.nodes.heading, {
      level,
    });
  for (let level = 1; level <= 3; level++)
    result[`Alt-Mod-${level}`] = blockStyle(schema.nodes.heading, { level });
  return result;
}

/** Plugins installed before Tac's submission and newline keymap. */
export function richEditorPlugins(schema: Schema): Plugin[] {
  if (!schema.nodes.heading) return [];
  const rules = inputRules({ rules: buildRules(schema) });
  const originalTextInput = rules.props.handleTextInput;
  rules.props.handleTextInput = function (view, ...args) {
    return !view.editable || activeCodeMark(view.state)
      ? false
      : (originalTextInput?.call(this, view, ...args) ?? false);
  };
  const originalComposition = rules.props.handleDOMEvents?.compositionend;
  rules.props.handleDOMEvents = {
    ...rules.props.handleDOMEvents,
    compositionend(view, event) {
      return !view.editable || activeCodeMark(view.state)
        ? false
        : (originalComposition?.call(this, view, event) ?? false);
    },
  };
  const fenceExit = new Plugin({
    props: {
      handleTextInput(view, from, to, value) {
        const { $from } = view.state.selection;
        if (
          view.composing ||
          value !== "`" ||
          from !== to ||
          $from.parent.type !== schema.nodes.code_block ||
          $from.parentOffset !== $from.parent.content.size
        )
          return false;
        const preceding = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 2),
          $from.parentOffset,
        );
        const start = $from.parentOffset - preceding.length;
        if (
          preceding !== "``" ||
          (start > 0 && $from.parent.textBetween(start - 1, start) !== "\n")
        )
          return false;
        const tr = view.state.tr.delete(from - 2 - Number(start > 0), from);
        const after = tr.selection.$from.after();
        tr.insert(after, schema.nodes.paragraph.create());
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)));
        return true;
      },
    },
  });
  const historyIsolation = new Plugin({
    filterTransaction(tr) {
      if (tr.getMeta(rules) != null) closeHistory(tr);
      return true;
    },
    appendTransaction(transactions, oldState, state) {
      if (transactions.length !== 1) return null;
      const tr = transactions[0],
        { $from, empty } = oldState.selection,
        first = tr.steps[0];
      if (
        !empty ||
        $from.parent.type !== schema.nodes.paragraph ||
        $from.parentOffset !== $from.parent.content.size ||
        !/^ {0,3}---$/.test($from.parent.textContent) ||
        activeCodeMark(oldState) ||
        tr.getMeta("addToHistory") === false ||
        tr.getMeta("paste") ||
        tr.getMeta("uiEvent") ||
        tr.getMeta("composition") != null ||
        tr.steps.length !== 1 ||
        !(first instanceof ReplaceStep) ||
        first.from !== $from.pos ||
        first.to !== $from.pos ||
        first.slice.openStart !== 1 ||
        first.slice.openEnd !== 1 ||
        first.slice.content.childCount !== 2 ||
        !tr.selection.empty ||
        tr.selection.from !== $from.pos + 2
      )
        return null;
      let emptyParagraphs = true;
      first.slice.content.forEach((node) => {
        if (node.type !== schema.nodes.paragraph || node.content.size)
          emptyParagraphs = false;
      });
      if (!emptyParagraphs) return null;
      return state.tr.replaceWith(
        $from.before(),
        $from.before() + $from.parent.nodeSize,
        schema.nodes.horizontal_rule.create(),
      );
    },
  });
  const listTab = new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          event.defaultPrevented ||
          event.key !== "Tab" ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
          return false;
        if (
          !richListItem(view.state) &&
          !view.state.selection.ranges.every(
            ({ $from, $to }) =>
              $from.sameParent($to) &&
              $from.nodeAfter != null &&
              isItem($from.nodeAfter.type),
          )
        )
          return false;
        event.preventDefault();
        listIndent(event.shiftKey)(view.state, view.dispatch);
        return true;
      },
    },
  });
  const blockquoteBackspace: Command = (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    if (
      !empty ||
      $from.parent.type !== schema.nodes.paragraph ||
      $from.parent.content.size
    )
      return false;
    if ($from.depth > 1 && $from.node(-1).type === schema.nodes.blockquote)
      return lift(state, dispatch, view);
    if (
      $from.depth !== 1 ||
      $from.index(0) <= 0 ||
      state.doc.child($from.index(0) - 1).type !== schema.nodes.blockquote
    )
      return false;
    const tr = state.tr.delete($from.before(), $from.after());
    const selection = Selection.findFrom(
      tr.doc.resolve(Math.max(0, $from.before() - 1)),
      -1,
      true,
    );
    if (selection) tr.setSelection(selection);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
  const deleteCodeSelection: Command = (state, dispatch) => {
    const { $from, $to, empty } = state.selection;
    if (
      empty ||
      $from.parent.type !== schema.nodes.code_block ||
      !$from.sameParent($to) ||
      $from.parentOffset !== 0 ||
      $to.parentOffset !== $to.parent.content.size
    )
      return false;
    dispatch?.(state.tr.deleteRange($from.before(), $from.after()));
    return true;
  };
  const codeBackspace: Command = (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type !== schema.nodes.code_block) return false;
    if (!$from.parent.content.size)
      return setBlockType(schema.nodes.paragraph)(state, dispatch, view);
    if (
      $from.parentOffset !== $from.parent.content.size ||
      $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) !==
        "\n"
    )
      return false;
    const tr = state.tr.delete($from.pos - 1, $from.pos),
      after = tr.mapping.map($from.after());
    tr.insert(after, schema.nodes.paragraph.create());
    dispatch?.(
      tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView(),
    );
    return true;
  };
  return [
    fenceExit,
    rules,
    historyIsolation,
    keymap({ Enter: richTypedTable }),
    keymap({ Backspace: blockquoteBackspace }),
    listTab,
    keymap({
      Backspace: chainCommands(deleteCodeSelection, codeBackspace),
      Delete: deleteCodeSelection,
      "Mod-Backspace": deleteCodeSelection,
      "Mod-Delete": deleteCodeSelection,
    }),
  ];
}
