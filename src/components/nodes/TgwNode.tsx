import { memo, useCallback, useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Network, ArrowRight, Ban, Link2, Server, Plug, Router, ChevronDown, ChevronRight } from 'lucide-react';

interface RouteTableConfig {
  associations?: string[];
  propagations?: string[];
  routes?: Record<string, string>;
}

interface TgwConnectPeer {
  asn?: number;
  enabled?: boolean;
  address?: string;
}

interface TgwConnectConfig {
  attachment?: string;
  address?: string;
  cidrs?: string[];
  peer?: TgwConnectPeer;
}

interface TgwNodeData {
  label: string;
  asn?: number;
  cidr: string;
  cidrs?: string[];
  peer?: boolean;
  tables?: Record<string, RouteTableConfig>;
  connects?: Record<string, TgwConnectConfig>;
}

/**
 * 路由目标类型判断
 * - blackhole: 黑洞路由
 * - peer: 对等连接（到主区域或其他区域）
 * - vpc: VPC 附件
 */
const getRouteType = (_key: string, target: string): 'blackhole' | 'peer' | 'vpc' => {
  if (target === 'blackhole') return 'blackhole';
  if (target === 'peer') return 'peer';
  return 'vpc';
};

/**
 * 路由键的显示文本
 * - * = 默认路由 (0.0.0.0/0)
 * - tgw = TGW 通用 CIDR
 * - main = 主区域 CIDR
 * - 区域名称 = 该区域 CIDR
 */
const getRouteKeyDisplay = (key: string): string => {
  if (key === '*') return '0.0.0.0/0 (默认)';
  if (key === 'tgw') return 'TGW CIDR';
  if (key === 'main') return '主区域 CIDR';
  // 检查是否是区域名称
  if (key.match(/^[a-z]{2}-[a-z]+-\d+$/)) {
    return `${key} CIDR`;
  }
  return key;
};

/**
 * 路由目标的显示文本
 */
const getRouteTargetDisplay = (key: string, target: string): string => {
  if (target === 'blackhole') return '黑洞 (丢弃)';
  if (target === 'peer') {
    if (key === 'main') return '主区域 TGW';
    if (key.match(/^[a-z]{2}-[a-z]+-\d+$/)) {
      return `${key} TGW`;
    }
    return '对等 TGW';
  }
  return `${target} VPC`;
};

/**
 * 获取路由的实际目标（用于高亮连线）
 * - 如果 target 是 peer，实际目标是 key（区域名称）
 * - 否则目标就是 target（VPC 名称）
 */
const getActualTarget = (key: string, target: string): string => {
  if (target === 'peer') {
    return key; // 区域名称或 main
  }
  return target;
};

const TgwNode = memo(({ data, id }: NodeProps) => {
  const nodeData = data as unknown as TgwNodeData;
  const { setEdges } = useReactFlow();
  // Default: all tables expanded
  const allTableNames = nodeData.tables ? Object.keys(nodeData.tables) : [];
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() => new Set(allTableNames));

  // Respond to collapse/expand signal from parent
  const collapseSignal = (data as Record<string, unknown>).collapseSignal as number | undefined;
  useEffect(() => {
    if (collapseSignal === undefined) return;
    if (collapseSignal > 0) setExpandedTables(new Set()); // collapse all
    else if (collapseSignal < 0) setExpandedTables(new Set(allTableNames)); // expand all
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseSignal]);

  // 从节点 ID 提取 regionId (格式: regionId-tgw)
  const regionId = id.replace('-tgw', '');

  const toggleTable = useCallback((tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName); else next.add(tableName);
      return next;
    });
  }, []);
  
  const getRouteIcon = (key: string, target: string) => {
    const type = getRouteType(key, target);
    if (type === 'blackhole') return <Ban size={11} className="route-icon blackhole" />;
    if (type === 'peer') return <Link2 size={11} className="route-icon peer" />;
    return <ArrowRight size={11} className="route-icon forward" />;
  };

  const getRouteClass = (key: string, target: string) => {
    const type = getRouteType(key, target);
    if (type === 'blackhole') return 'route-blackhole';
    if (type === 'peer') return 'route-peer';
    return 'route-forward';
  };

  const handleRouteMouseEnter = useCallback((key: string, target: string) => {
    const type = getRouteType(key, target);
    if (type === 'blackhole') return;
    
    const actualTarget = getActualTarget(key, target);
    
    setEdges((edges) => 
      edges.map((edge) => {
        let isTargetEdge = false;
        
        if (type === 'peer') {
          if (actualTarget === 'main') {
            // main 路由：高亮从当前 TGW 到主区域 TGW 的连线
            isTargetEdge = edge.source === 'main-tgw' && edge.target === id;
          } else {
            // 区域路由：高亮从主区域 TGW 到目标区域 TGW 的连线
            isTargetEdge = edge.id === `tgw-peer-${actualTarget}`;
          }
        } else {
          // VPC 路由：高亮到该 VPC 的连线
          isTargetEdge = 
            edge.source === id && 
            (edge.target === `${regionId}-${actualTarget}` || edge.id.includes(`tgw-${actualTarget}`));
        }
        
        if (isTargetEdge) {
          return {
            ...edge,
            style: {
              ...edge.style,
              stroke: '#22c55e',
              strokeWidth: 4,
              filter: 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))',
              opacity: 1,
            },
            animated: true,
          };
        }
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: 0.2,
          },
        };
      })
    );
  }, [id, regionId, setEdges]);

  const handleRouteMouseLeave = useCallback(() => {
    setEdges((edges) =>
      edges.map((edge) => ({
        ...edge,
        style: {
          stroke: '#F59E0B',
          strokeWidth: 2,
          strokeDasharray: edge.id.includes('peer') ? '8,4' : undefined,
          opacity: 1,
          filter: undefined,
        },
        animated: true,
      }))
    );
  }, [setEdges]);

  const handleAssocMouseEnter = useCallback((vpcName: string) => {
    setEdges((edges) =>
      edges.map((edge) => {
        const isTargetEdge = edge.target === `${regionId}-${vpcName}` || 
                            edge.target?.endsWith(`-${vpcName}`);
        if (isTargetEdge) {
          return {
            ...edge,
            style: {
              ...edge.style,
              stroke: '#22c55e',
              strokeWidth: 4,
              filter: 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))',
              opacity: 1,
            },
          };
        }
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: 0.2,
          },
        };
      })
    );
  }, [regionId, setEdges]);

  return (
    <div className={`tgw-node ${nodeData.peer ? 'tgw-peer' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Left} id="source-left" style={{ top: '50%' }} />
      
      <div className="tgw-header">
        <Network size={16} />
        <span>Transit Gateway</span>
        {nodeData.peer && <span className="tgw-peer-badge">PEER</span>}
      </div>
      
      <div className="tgw-meta">
        {nodeData.asn != null && (
        <div className="tgw-meta-row">
          <span className="meta-label">ASN</span>
          <span className="meta-value">{nodeData.asn}</span>
        </div>
        )}
        <div className="tgw-meta-row">
          <span className="meta-label">CIDR</span>
          <span className="meta-value">{nodeData.cidr}</span>
        </div>
        {nodeData.cidrs && nodeData.cidrs.length > 0 && (
          <div className="tgw-meta-row">
            <span className="meta-label">额外 CIDR</span>
            <span className="meta-value">{nodeData.cidrs.join(', ')}</span>
          </div>
        )}
        {nodeData.peer && (
          <div className="tgw-peer-info">
            <Link2 size={10} />
            <span>对等连接到主区域</span>
          </div>
        )}
      </div>

      {/* TGW Connect 附件 */}
      {nodeData.connects && Object.keys(nodeData.connects).length > 0 && (
        <div className="tgw-connects">
          <div className="connects-header">
            <Plug size={12} />
            <span>Connect 附件</span>
          </div>
          {Object.entries(nodeData.connects).map(([connectName, connectConfig]) => (
            <div key={connectName} className="connect-item">
              <div className="connect-name">
                <Router size={12} />
                <span>{connectName}</span>
              </div>
              {connectConfig.attachment && (
                <div className="connect-detail">
                  <span className="detail-label">VPC 附件:</span>
                  <span className="detail-value">{connectConfig.attachment}</span>
                </div>
              )}
              {connectConfig.cidrs && connectConfig.cidrs.length > 0 && (
                <div className="connect-detail">
                  <span className="detail-label">BGP CIDR:</span>
                  <span className="detail-value">{connectConfig.cidrs.join(', ')}</span>
                </div>
              )}
              {connectConfig.peer && connectConfig.peer.enabled && (
                <div className="connect-peer">
                  <span className="peer-label">对等设备:</span>
                  <div className="peer-details">
                    {connectConfig.peer.asn && (
                      <span className="peer-tag">ASN: {connectConfig.peer.asn}</span>
                    )}
                    {connectConfig.peer.address && (
                      <span className="peer-tag">IP: {connectConfig.peer.address}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {nodeData.tables && Object.keys(nodeData.tables).length > 0 && (
        <div className="tgw-tables">
          {Object.entries(nodeData.tables).map(([tableName, tableConfig]) => {
            const isExpanded = expandedTables.has(tableName);
            const assocCount = tableConfig.associations?.length || 0;
            const propCount = tableConfig.propagations?.length || 0;
            const routeCount = tableConfig.routes ? Object.keys(tableConfig.routes).length : 0;
            return (
            <div key={tableName} className={`route-table ${isExpanded ? 'expanded' : 'collapsed'}`}>
              <div className="route-table-header rt-clickable" onClick={(e) => toggleTable(tableName, e)}>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Server size={12} />
                <span className="table-name">路由表: {tableName.toUpperCase()}</span>
                {!isExpanded && (
                  <span className="rt-summary">
                    {assocCount > 0 && <span className="rt-count">{assocCount} 关联</span>}
                    {propCount > 0 && <span className="rt-count">{propCount} 传播</span>}
                    {routeCount > 0 && <span className="rt-count">{routeCount} 路由</span>}
                  </span>
                )}
              </div>

              {isExpanded && tableConfig.associations && tableConfig.associations.length > 0 && (
                <div className="table-section">
                  <span className="section-label">关联 (使用此表):</span>
                  <div className="section-items">
                    {tableConfig.associations.map((vpc, i) => (
                      <span
                        key={i}
                        className={`assoc-tag hoverable ${vpc === 'peer' ? 'peer-assoc' : ''}`}
                        onMouseEnter={() => vpc !== 'peer' && handleAssocMouseEnter(vpc)}
                        onMouseLeave={handleRouteMouseLeave}
                        title={vpc === 'peer' ? '对等附件使用此路由表' : `${vpc} VPC 使用此路由表`}
                      >
                        {vpc === 'peer' ? '对等附件' : vpc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && tableConfig.propagations && tableConfig.propagations.length > 0 && (
                <div className="table-section">
                  <span className="section-label">传播 (学习路由):</span>
                  <div className="section-items">
                    {tableConfig.propagations.map((vpc, i) => (
                      <span
                        key={i}
                        className="prop-tag hoverable"
                        onMouseEnter={() => handleAssocMouseEnter(vpc)}
                        onMouseLeave={handleRouteMouseLeave}
                        title={`从 ${vpc} VPC 学习路由`}
                      >
                        {vpc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && tableConfig.routes && Object.keys(tableConfig.routes).length > 0 && (
                <div className="table-routes">
                  <div className="routes-header">静态路由:</div>
                  {Object.entries(tableConfig.routes).map(([dest, target], i) => {
                    const type = getRouteType(dest, target);
                    const isHoverable = type !== 'blackhole';
                    return (
                      <div
                        key={i}
                        className={`route-entry ${getRouteClass(dest, target)} ${isHoverable ? 'hoverable' : ''}`}
                        onMouseEnter={() => isHoverable && handleRouteMouseEnter(dest, target)}
                        onMouseLeave={handleRouteMouseLeave}
                        title={type === 'blackhole' ? '黑洞路由 - 丢弃匹配流量' :
                               type === 'peer' ? `通过 TGW 对等连接路由到 ${getActualTarget(dest, target)}` :
                               `路由到 ${target} VPC`}
                      >
                        {getRouteIcon(dest, target)}
                        <span className="route-dest">{getRouteKeyDisplay(dest)}</span>
                        <span className="route-arrow">→</span>
                        <span className="route-target">{getRouteTargetDisplay(dest, target)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" style={{ left: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="bottom-left" style={{ left: '25%' }} />
      <Handle type="source" position={Position.Bottom} id="bottom-right" style={{ left: '75%' }} />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Right} id="source-right" style={{ top: '50%' }} />
    </div>
  );
});

TgwNode.displayName = 'TgwNode';
export default TgwNode;
