import { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Code, ChevronLeft, ChevronRight, Check, AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface JsonEditorPanelProps {
  jsonText: string;
  selectedPath: string | null;
  onApply: (text: string) => string | null;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * 在 JSON 文本中查找指定路径对应的行范围
 * 返回 { startLine, endLine } (1-indexed)
 */
function findJsonPathRange(
  text: string,
  path: string
): { startLine: number; endLine: number } | null {
  if (!path || !text) return null;

  const parts = path.split('.');
  let searchKey = parts[parts.length - 1];
  let parentKeys = parts.slice(0, -1);

  // 在文本中逐行搜索
  const lines = text.split('\n');
  let depth = 0;
  let parentDepth = 0;
  let parentMatchIndex = 0;
  let foundStart = -1;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跟踪父路径匹配
    if (parentMatchIndex < parentKeys.length) {
      const parentKey = parentKeys[parentMatchIndex];
      const parentPattern = new RegExp(`^"${escapeRegex(parentKey)}"\\s*:`);
      if (parentPattern.test(trimmed) && depth === parentMatchIndex + 1) {
        parentMatchIndex++;
        parentDepth = depth;
      }
    }

    // 查找目标 key
    if (parentMatchIndex === parentKeys.length && foundStart === -1) {
      const keyPattern = new RegExp(`^"${escapeRegex(searchKey)}"\\s*:`);
      const expectedDepth = parentKeys.length + 1;
      if (keyPattern.test(trimmed) && depth === expectedDepth) {
        foundStart = i;
        // 计算值的开始位置
        const colonIdx = line.indexOf(':');
        const afterColon = line.substring(colonIdx + 1).trim();
        if (afterColon.startsWith('{') || afterColon.startsWith('[')) {
          braceCount = 1;
        } else if (afterColon.endsWith(',')) {
          // 单行值
          return { startLine: i + 1, endLine: i + 1 };
        } else {
          // 可能是最后一个属性（无逗号）
          return { startLine: i + 1, endLine: i + 1 };
        }
        continue;
      }
    }

    // 跟踪大括号深度
    for (const ch of trimmed) {
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
    }

    // 如果已找到开始，跟踪块结束
    if (foundStart !== -1) {
      for (const ch of trimmed) {
        if (ch === '{' || ch === '[') braceCount++;
        if (ch === '}' || ch === ']') braceCount--;
      }
      if (braceCount <= 0) {
        return { startLine: foundStart + 1, endLine: i + 1 };
      }
    }
  }

  // 如果找到了开始但没找到结束（文件末尾）
  if (foundStart !== -1) {
    return { startLine: foundStart + 1, endLine: lines.length };
  }

  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function JsonEditorPanel({
  jsonText,
  selectedPath,
  onApply,
  isOpen,
  onToggle,
}: JsonEditorPanelProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const { t } = useLanguage();
  const [localText, setLocalText] = useState(jsonText);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 外部 jsonText 变化时同步（非编辑器主动修改的情况）
  useEffect(() => {
    if (!isDirty) {
      setLocalText(jsonText);
    }
  }, [jsonText, isDirty]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsRef.current = editor.createDecorationsCollection([]);
  }, []);

  // 选中路径变化时，滚动并高亮对应块
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !selectedPath) {
      // 清除高亮
      decorationsRef.current?.clear();
      return;
    }

    const textToSearch = isDirty ? localText : jsonText;
    const range = findJsonPathRange(textToSearch, selectedPath);
    if (!range) {
      decorationsRef.current?.clear();
      return;
    }

    // 高亮整个资源块
    decorationsRef.current?.set([
      {
        range: new monaco.Range(range.startLine, 1, range.endLine, 1),
        options: {
          isWholeLine: true,
          className: 'json-highlight-block',
          overviewRuler: {
            color: '#f59e0b',
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      },
    ]);

    // 滚动到高亮区域
    editor.revealLineInCenter(range.startLine);
  }, [selectedPath, jsonText, localText, isDirty]);

  const handleApply = useCallback(() => {
    const err = onApply(localText);
    if (err) {
      setError(err);
    } else {
      setError(null);
      setIsDirty(false);
    }
  }, [localText, onApply]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setLocalText(value);
      setIsDirty(true);
      setError(null);
    }
  }, []);

  // Ctrl+S 快捷键应用
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && isOpen) {
        e.preventDefault();
        handleApply();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleApply, isOpen]);

  return (
    <>
      <button
        className={`editor-panel-toggle ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
      >
        {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        {!isOpen && (
          <span className="toggle-label-v">
            <Code size={12} />
            JSON
          </span>
        )}
      </button>

      <div className={`editor-panel ${isOpen ? 'open' : ''}`}>
        <div className="editor-panel-header">
          <Code size={14} />
          <span>{t('JSON 编辑器', 'JSON Editor')}</span>
          {isDirty && <span className="dirty-indicator">●</span>}
          <div className="editor-panel-actions">
            {isDirty && (
              <button className="btn-sm btn-primary" onClick={handleApply} title={t('应用修改 (Ctrl+S)', 'Apply (Ctrl+S)')}>
                <Check size={12} />
                <span>{t('应用', 'Apply')}</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="editor-panel-error">
            <AlertCircle size={12} />
            <span>{error}</span>
          </div>
        )}

        <div className="editor-panel-body">
          <Editor
            height="100%"
            language="json"
            theme="vs-dark"
            value={localText}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              folding: true,
              automaticLayout: true,
              tabSize: 2,
              renderLineHighlight: 'line',
              scrollbar: { verticalScrollbarSize: 8 },
            }}
          />
        </div>
      </div>
    </>
  );
}
