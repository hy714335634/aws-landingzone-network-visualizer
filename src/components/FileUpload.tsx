import { useCallback } from 'react';
import { Upload, FileJson } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface FileUploadProps {
  onFileLoad: (config: unknown) => void;
}

export default function FileUpload({ onFileLoad }: FileUploadProps) {
  const { t } = useLanguage();

  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onFileLoad(json);
      } catch {
        alert(t('JSON 文件格式无效', 'Invalid JSON file'));
      }
    };
    reader.readAsText(file);
  }, [onFileLoad, t]);

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
      <h3>{t('上传网络配置', 'Upload Network Configuration')}</h3>
      <p>{t('拖拽 JSON 文件到此处，或点击选择文件', 'Drag and drop a JSON file here, or click to select')}</p>
      <label className="upload-button">
        <Upload size={18} />
        <span>{t('选择文件', 'Select File')}</span>
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
