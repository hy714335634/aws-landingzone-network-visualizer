import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Network } from 'lucide-react';

interface TopoTgwNodeData {
  label: string;
  asn?: number;
  cidr: string;
  peer?: boolean;
}

const TopoTgwNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoTgwNodeData;
  return (
    <div className={`topo-tgw ${d.peer ? 'is-peer' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Top} id="source-top" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <div className="topo-tgw-row">
        <Network size={14} />
        <span>TGW</span>
        {d.peer && <span className="topo-badge peer">PEER</span>}
      </div>
      {d.asn != null && <div className="topo-tgw-detail">ASN {d.asn}</div>}
      <div className="topo-tgw-detail">{d.cidr}</div>
    </div>
  );
});

TopoTgwNode.displayName = 'TopoTgwNode';
export default TopoTgwNode;
