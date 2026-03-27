import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, NodeTypes, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { NetworkConfig } from '../types/network';
import { parseNetworkConfig, parseNetworkConfigSimplified } from '../utils/networkParser';
import { validateNetworkConfig } from '../utils/configValidator';
import type { ValidationMessage } from '../utils/configValidator';
import { useUndoRedo } from '../hooks/useUndoRedo';
import VpcNode from './nodes/VpcNode';
import TgwNode from './nodes/TgwNode';
import SubnetNode from './nodes/SubnetNode';
import SubnetGroupNode from './nodes/SubnetGroupNode';
import RegionNode from './nodes/RegionNode';
import AzNode from './nodes/AzNode';
import TopoVpcNode from './nodes/SimpleVpcNode';
import TopoTgwNode from './nodes/SimpleTgwNode';
import TopoAccountNode from './nodes/TopoAccountNode';
import TopoComponentNode from './nodes/TopoComponentNode';
import TopoRegionLabelNode from './nodes/TopoRegionLabelNode';
import TopoEndpointNode from './nodes/TopoEndpointNode';
import TopoDxNode from './nodes/TopoDxNode';
import FileUpload from './FileUpload';
import JsonEditorPanel from './JsonEditorPanel';
import Toolbar from './Toolbar';
import type { ViewMode } from './Toolbar';
import SidePanel from './SidePanel';

const nodeTypes: NodeTypes = {
  vpc: VpcNode,
  tgw: TgwNode,
  subnet: SubnetNode,
  subnetGroup: SubnetGroupNode,
  region: RegionNode,
  az: AzNode,
  topoVpc: TopoVpcNode,
  topoTgw: TopoTgwNode,
  topoAccount: TopoAccountNode,
  topoComponent: TopoComponentNode,
  topoRegionLabel: TopoRegionLabelNode,
  topoEndpoint: TopoEndpointNode,
  topoDx: TopoDxNode,
};

function NetworkFlowInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [showUpload, setShowUpload] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('detailed');
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // 保留完整原始 JSON 对象（包含未可视化字段如安全组）
  const fullConfigRef = useRef<unknown>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowInstance = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { takeSnapshot, undo, redo, canUndo, canRedo, reset } = useUndoRedo([], []);

  const parseConfig = useCallback((networkConfig: NetworkConfig, mode: ViewMode) => {
    if (mode === 'simplified') {
      return parseNetworkConfigSimplified(networkConfig);
    }
    return parseNetworkConfig(networkConfig);
  }, []);

  // 同步 config → jsonText
  const syncJsonText = useCallback((cfg: unknown) => {
    setJsonText(JSON.stringify(cfg, null, 2));
  }, []);

  // 应用配置并刷新可视化
  const applyConfig = useCallback((networkConfig: NetworkConfig, fullObj?: unknown) => {
    fullConfigRef.current = fullObj || networkConfig;
    setConfig(networkConfig);
    syncJsonText(fullConfigRef.current);

    const msgs = validateNetworkConfig(networkConfig);
    setValidationMessages(msgs);
    if (msgs.some(m => m.level === 'error' || m.level === 'warning')) {
      setShowValidation(true);
    } else {
      setShowValidation(false);
    }

    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [parseConfig, viewMode, setNodes, setEdges, reset, syncJsonText]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          const state = redo();
          if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
        } else {
          e.preventDefault();
          const state = undo();
          if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        const state = redo();
        if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setNodes, setEdges]);

  // 文件加载
  const handleFileLoad = useCallback((newConfig: unknown) => {
    const networkConfig = newConfig as NetworkConfig;
    setShowUpload(false);
    applyConfig(networkConfig, newConfig);
  }, [applyConfig]);

  // 编辑器文本应用
  const handleEditorApply = useCallback((text: string): string | null => {
    try {
      const parsed = JSON.parse(text);
      const networkConfig = parsed as NetworkConfig;
      fullConfigRef.current = parsed;
      setConfig(networkConfig);
      setJsonText(text);

      const msgs = validateNetworkConfig(networkConfig);
      setValidationMessages(msgs);
      setShowValidation(msgs.some(m => m.level === 'error' || m.level === 'warning'));

      const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
      setNodes(parsedNodes as Node[]);
      setEdges(parsedEdges as Edge[]);
      reset(parsedNodes as Node[], parsedEdges as Edge[]);

      setTimeout(() => {
        reactFlowInstance.current?.fitView({ padding: 0.1 });
      }, 100);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [parseConfig, viewMode, setNodes, setEdges, reset]);

  // 下载完整 JSON（包含未可视化字段）
  const handleDownload = useCallback(() => {
    const data = fullConfigRef.current || config;
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          handleFileLoad(json);
        } catch {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  }, [handleFileLoad]);

  const handleRefresh = useCallback(() => {
    if (sourceFile) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          handleFileLoad(json);
        } catch {
          alert('刷新失败：无法解析 JSON 文件');
        }
      };
      reader.readAsText(sourceFile);
    } else if (config) {
      applyConfig(config, fullConfigRef.current);
    }
  }, [sourceFile, config, handleFileLoad, applyConfig]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === viewMode || !config) return;
    setViewMode(mode);
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(config, mode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);
    setTimeout(() => { reactFlowInstance.current?.fitView({ padding: 0.1 }); }, 100);
  }, [viewMode, config, parseConfig, setNodes, setEdges, reset]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeDragStop = useCallback((_: any, __: any, allNodes: Node[]) => {
    takeSnapshot(allNodes, edges as Edge[]);
  }, [takeSnapshot, edges]);

  const handleUndo = useCallback(() => {
    const state = undo();
    if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const state = redo();
    if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
  }, [redo, setNodes, setEdges]);

  // 节点点击 → 联动编辑器
  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const jp = (node.data as Record<string, unknown>)?.jsonPath as string | undefined;
    if (jp) {
      setSelectedPath(jp);
      // 如果编辑器未打开，自动打开
      if (!editorOpen) {
        setEditorOpen(true);
      }
    }
  }, [editorOpen]);

  // 画布空白处点击 → 清除选中
  const handlePaneClick = useCallback(() => {
    setSelectedPath(null);
  }, []);

  const handleConfigUpdate = useCallback((newConfig: NetworkConfig) => {
    applyConfig(newConfig, newConfig);
  }, [applyConfig]);

  return (
    <div className="network-flow">
      <Toolbar
        onUpload={handleUploadClick}
        onEdit={() => setEditorOpen(!editorOpen)}
        onDownload={handleDownload}
        onRefresh={handleRefresh}
        onZoomIn={() => reactFlowInstance.current?.zoomIn()}
        onZoomOut={() => reactFlowInstance.current?.zoomOut()}
        onFitView={() => reactFlowInstance.current?.fitView({ padding: 0.1 })}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        hasConfig={!!config}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelect}
        hidden
        id="file-upload-input"
        name="file-upload"
      />

      {/* 左侧 JSON 编辑器面板 */}
      {config && (
        <JsonEditorPanel
          jsonText={jsonText}
          selectedPath={selectedPath}
          onApply={handleEditorApply}
          isOpen={editorOpen}
          onToggle={() => setEditorOpen(!editorOpen)}
        />
      )}

      <SidePanel
        config={config}
        onConfigUpdate={handleConfigUpdate}
      />

      {showUpload && !config ? (
        <FileUpload onFileLoad={handleFileLoad} />
      ) : (
        <div className="react-flow-wrapper">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
              instance.fitView({ padding: 0.1 });
            }}
            fitView
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
          >
            <Background color="#334155" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                if (node.type === 'vpc' || node.type === 'topoVpc') return '#4ECDC4';
                if (node.type === 'tgw' || node.type === 'topoTgw') return '#F59E0B';
                if (node.type === 'region' || node.type === 'topoRegionLabel') return '#3B82F6';
                if (node.type === 'az') return '#475569';
                if (node.type === 'topoAccount') return '#60a5fa';
                if (node.type === 'topoComponent') return '#22c55e';
                if (node.type === 'topoEndpoint') return '#8b5cf6';
                if (node.type === 'topoDx') return '#f97316';
                return '#6B7280';
              }}
              maskColor="rgba(15, 23, 42, 0.8)"
            />
          </ReactFlow>
        </div>
      )}

      {showValidation && validationMessages.length > 0 && (
        <div className="validation-panel">
          <div className="validation-header">
            <span>配置校验</span>
            <span className="validation-counts">
              {validationMessages.filter(m => m.level === 'error').length > 0 && (
                <span className="count-error">{validationMessages.filter(m => m.level === 'error').length} 错误</span>
              )}
              {validationMessages.filter(m => m.level === 'warning').length > 0 && (
                <span className="count-warning">{validationMessages.filter(m => m.level === 'warning').length} 警告</span>
              )}
              {validationMessages.filter(m => m.level === 'info').length > 0 && (
                <span className="count-info">{validationMessages.filter(m => m.level === 'info').length} 提示</span>
              )}
            </span>
            <button className="validation-close" onClick={() => setShowValidation(false)}>✕</button>
          </div>
          <div className="validation-list">
            {validationMessages.map((msg, i) => (
              <div key={i} className={`validation-item validation-${msg.level}`}>
                <span className="validation-icon">
                  {msg.level === 'error' ? '✗' : msg.level === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <div className="validation-content">
                  <span className="validation-path">{msg.path}</span>
                  <span className="validation-msg">{msg.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NetworkFlow() {
  return (
    <ReactFlowProvider>
      <NetworkFlowInner />
    </ReactFlowProvider>
  );
}
