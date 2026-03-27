import { useState, useEffect } from 'react';
import { Save, X, Code, AlertCircle } from 'lucide-react';

interface JsonEditorProps {
  config: unknown;
  onSave: (config: unknown) => void;
  onClose: () => void;
}

export default function JsonEditor({ config, onSave, onClose }: JsonEditorProps) {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJsonText(JSON.stringify(config, null, 2));
  }, [config]);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setError(null);
      onSave(parsed);
    } catch {
      setError('Invalid JSON format');
    }
  };

  const handleDownload = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'network-config.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Invalid JSON format');
    }
  };

  return (
    <div className="json-editor-overlay">
      <div className="json-editor">
        <div className="editor-header">
          <div className="editor-title">
            <Code size={20} />
            <span>JSON Editor</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        {error && (
          <div className="editor-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        
        <textarea
          className="editor-textarea"
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
        />
        
        <div className="editor-actions">
          <button className="btn btn-secondary" onClick={handleDownload}>
            Download JSON
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            <Save size={16} />
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
