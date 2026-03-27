import { Upload, Edit, Download, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, RefreshCw, LayoutGrid, List, Image } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export type ViewMode = 'detailed' | 'simplified';

interface ToolbarProps {
  onUpload: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onExportSvg: () => void;
  onRefresh: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasConfig: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  editorOpen?: boolean;
}

export default function Toolbar({
  onUpload,
  onEdit,
  onDownload,
  onExportSvg,
  onRefresh,
  onZoomIn,
  onZoomOut,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasConfig,
  viewMode,
  onViewModeChange,
  editorOpen,
}: ToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className={`toolbar ${editorOpen ? 'toolbar-shifted' : ''}`}>
      <div className="toolbar-group">
        <button className="toolbar-btn toolbar-btn-labeled" onClick={onUpload}>
          <Upload size={16} />
          <span className="toolbar-label">{t('上传', 'Upload')}</span>
        </button>
        {hasConfig && (
          <>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onRefresh}>
              <RefreshCw size={16} />
              <span className="toolbar-label">{t('刷新', 'Refresh')}</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onEdit}>
              <Edit size={16} />
              <span className="toolbar-label">JSON</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onDownload}>
              <Download size={16} />
              <span className="toolbar-label">{t('下载', 'Save')}</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onExportSvg}>
              <Image size={16} />
              <span className="toolbar-label">SVG</span>
            </button>
          </>
        )}
      </div>

      {hasConfig && (
        <div className="toolbar-group">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'detailed' ? 'active' : ''}`}
              onClick={() => onViewModeChange('detailed')}
            >
              <List size={14} />
              <span>{t('详细', 'Detail')}</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'simplified' ? 'active' : ''}`}
              onClick={() => onViewModeChange('simplified')}
            >
              <LayoutGrid size={14} />
              <span>{t('拓扑', 'Topo')}</span>
            </button>
          </div>
        </div>
      )}

      {hasConfig && (
        <div className="toolbar-group">
          <button
            className={`toolbar-btn toolbar-btn-labeled ${!canUndo ? 'disabled' : ''}`}
            onClick={onUndo}
            disabled={!canUndo}
          >
            <Undo2 size={16} />
            <span className="toolbar-label">{t('撤销', 'Undo')}</span>
          </button>
          <button
            className={`toolbar-btn toolbar-btn-labeled ${!canRedo ? 'disabled' : ''}`}
            onClick={onRedo}
            disabled={!canRedo}
          >
            <Redo2 size={16} />
            <span className="toolbar-label">{t('重做', 'Redo')}</span>
          </button>
        </div>
      )}

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomIn} title={t('放大', 'Zoom In')}>
          <ZoomIn size={16} />
        </button>
        <button className="toolbar-btn" onClick={onZoomOut} title={t('缩小', 'Zoom Out')}>
          <ZoomOut size={16} />
        </button>
        <button className="toolbar-btn" onClick={onFitView} title={t('适应视图', 'Fit View')}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
