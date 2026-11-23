// Lista de extensiones del editor. La misma lista (sin la parte colaborativa) sirve para
// convertir HTML/JSON sin abrir un editor: plantillas, .docx importados y versiones viejas.
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { Mathematics } from '@tiptap/extension-mathematics';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import {
  ParagraphFormat, PageBreak, TableOfContents, CommentMark, ActiveComment, SearchReplace, StorageImage,
} from './custom.js';

export function baseExtensions({ onMathClick } = {}) {
  return [
    StarterKit.configure({
      undoRedo: false,   // con colaboración, deshacer lo maneja Yjs (cada uno deshace lo suyo)
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      dropcursor: { color: '#2b62a6', width: 2 },
    }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, cellMinWidth: 40 }),
    TableRow,
    TableHeader,
    TableCell,
    StorageImage.configure({ allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 40, minHeight: 20 } }),
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: { onClick: (node, pos) => onMathClick?.(node, pos, 'inline') },
      blockOptions: { onClick: (node, pos) => onMathClick?.(node, pos, 'block') },
    }),
    ParagraphFormat,
    PageBreak,
    TableOfContents,
    CommentMark,
  ];
}

export function editorExtensions({ ydoc, provider, user, onMathClick }) {
  return [
    ...baseExtensions({ onMathClick }),
    Placeholder.configure({ placeholder: 'Escribí acá…' }),
    CharacterCount,
    ActiveComment,
    SearchReplace,
    Collaboration.configure({ document: ydoc, field: 'default' }),
    CollaborationCaret.configure({
      provider,
      user,
      render: (u) => {
        const caret = document.createElement('span');
        caret.className = 'dz-caret';
        caret.style.setProperty('--c', u.color);
        const label = document.createElement('span');
        label.className = 'dz-caret-label';
        label.textContent = u.name;
        caret.append(label);
        return caret;
      },
      selectionRender: (u) => ({ nodeName: 'span', class: 'dz-caret-selection', style: `background-color:${u.color}33`, 'data-user': u.name }),
    }),
  ];
}
