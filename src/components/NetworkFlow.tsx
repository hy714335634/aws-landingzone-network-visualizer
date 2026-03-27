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
import type { Node, Edge, NodeTypes } from '@xyflow/react';
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
import JsonEditor from './JsonEditor';
import Toolbar from './Toolbar';
import type { ViewMode } from './Toolbar';
import SidePanel from './SidePanel';

// 在组件外部定义 nodeTypes
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
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showUpload, setShowUpload] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('detailed');
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowInstance = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { takeSnapshot, undo, redo, canUndo, canRedo, reset } = useUndoRedo([], []);

  // 根据视图模式解析配置
  const parseConfig = useCallback((networkConfig: NetworkConfig, mode: ViewMode) => {
    if (mode === 'simplified') {
      return parseNetworkConfigSimplified(networkConfig);
    }
    return parseNetworkConfig(networkConfig);
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          const state = redo();
          if (state) {
            setNodes(state.nodes as Node[]);
            setEdges(state.edges as Edge[]);
          }
        } else {
          e.preventDefault();
          const state = undo();
          if (state) {
            setNodes(state.nodes as Node[]);
            setEdges(state.edges as Edge[]);
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        const state = redo();
        if (state) {
          setNodes(state.nodes as Node[]);
          setEdges(state.edges as Edge[]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setNodes, setEdges]);

  const handleFileLoad = useCallback((newConfig: unknown) => {
    const networkConfig = newConfig as NetworkConfig;
    setConfig(networkConfig);
    const msgs = validateNetworkConfig(networkConfig);
    setValidationMessages(msgs);
    if (msgs.some(m => m.level === 'error' || m.level === 'warning')) {
      setShowValidation(true);
    }
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    setShowUpload(false);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [setNodes, setEdges, reset, parseConfig, viewMode]);

  const handleSaveConfig = useCallback((newConfig: unknown) => {
    const networkConfig = newConfig as NetworkConfig;
    setConfig(networkConfig);
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    setShowEditor(false);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [setNodes, setEdges, reset, parseConfig, viewMode]);

  const handleDownload = useCallback(() => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
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

  // 刷新：重新加载源文件
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
      const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(config, viewMode);
      setNodes(parsedNodes as Node[]);
      setEdges(parsedEdges as Edge[]);
      reset(parsedNodes as Node[], parsedEdges as Edge[]);
      setTimeout(() => {
        reactFlowInstance.current?.fitView({ padding: 0.1 });
      }, 100);
    }
  }, [sourceFile, config, handleFileLoad, setNodes, setEdges, reset, parseConfig, viewMode]);

  // 视图模式切换
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === viewMode || !config) return;
    setViewMode(mode);
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(config, mode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [viewMode, config, parseConfig, setNodes, setEdges, reset]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeDragStop = useCallback((_: any, __: any, allNodes: Node[]) => {
    takeSnapshot(allNodes, edges as Edge[]);
  }, [takeSnapshot, edges]);

  const handleUndo = useCallback(() => {
    const state = undo();
    if (state) {
      setNodes(state.nodes as Node[]);
      setEdges(state.edges as Edge[]);
    }
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const state = redo();
    if (state) {
      setNodes(state.nodes as Node[]);
      setEdges(state.edges as Edge[]);
    }
  }, [redo, setNodes, setEdges]);

  // 处理配置更新（从 SidePanel 添加/删除 VPC）
  const handleConfigUpdate = useCallback((newConfig: NetworkConfig) => {
    setConfig(newConfig);
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(newConfig, viewMode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [setNodes, setEdges, reset, parseConfig, viewMode]);

  return (
    <div className="network-flow">
      <Toolbar
        onUpload={handleUploadClick}
        onEdit={() => setShowEditor(true)}
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

      {showEditor && config && (
        <JsonEditor
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowEditor(false)}
        />
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
