import { Upload, Edit, Download, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, RefreshCw, LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'detailed' | 'simplified';

interface ToolbarProps {
  onUpload: () => void;
  onEdit: () => void;
  onDownload: () => void;
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
}

export default function Toolbar({
  onUpload,
  onEdit,
  onDownload,
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
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onUpload} title="上传 JSON">
          <Upload size={18} />
        </button>
        {hasConfig && (
          <>
            <button className="toolbar-btn" onClick={onRefresh} title="刷新 (重新加载)">
              <RefreshCw size={18} />
            </button>
            <button className="toolbar-btn" onClick={onEdit} title="编辑 JSON">
              <Edit size={18} />
            </button>
            <button className="toolbar-btn" onClick={onDownload} title="下载 JSON">
              <Download size={18} />
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
              title="详细视图"
            >
              <List size={14} />
              <span>详细</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'simplified' ? 'active' : ''}`}
              onClick={() => onViewModeChange('simplified')}
              title="简化视图"
            >
              <LayoutGrid size={14} />
              <span>拓扑</span>
            </button>
          </div>
        </div>
      )}

      {hasConfig && (
        <div className="toolbar-group">
          <button
            className={`toolbar-btn ${!canUndo ? 'disabled' : ''}`}
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 size={18} />
          </button>
          <button
            className={`toolbar-btn ${!canRedo ? 'disabled' : ''}`}
            onClick={onRedo}
            disabled={!canRedo}
            title="重做 (Ctrl+Shift+Z)"
          >
            <Redo2 size={18} />
          </button>
        </div>
      )}

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomIn} title="放大">
          <ZoomIn size={18} />
        </button>
        <button className="toolbar-btn" onClick={onZoomOut} title="缩小">
          <ZoomOut size={18} />
        </button>
        <button className="toolbar-btn" onClick={onFitView} title="适应视图">
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}
