import { useCallback } from 'react';
import { Upload, FileJson } from 'lucide-react';

interface FileUploadProps {
  onFileLoad: (config: unknown) => void;
}

export default function FileUpload({ onFileLoad }: FileUploadProps) {
  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onFileLoad(json);
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }, [onFileLoad]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/json') {
        readFile(file);
      }
    },
    [readFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        readFile(file);
      }
    },
    [readFile]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div
      className="file-upload"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <FileJson size={48} className="upload-icon" />
      <h3>Upload Network Configuration</h3>
      <p>Drag and drop a JSON file here, or click to select</p>
      <label className="upload-button">
        <Upload size={18} />
        <span>Select File</span>
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelect}
          hidden
          id="file-select-input"
          name="file-select"
        />
      </label>
    </div>
  );
}
