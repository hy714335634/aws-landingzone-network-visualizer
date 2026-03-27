import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Cloud } from 'lucide-react';

interface TopoVpcNodeData {
  label: string;
  cidr: string;
  isHub?: boolean;
  isEndpoint?: boolean;
}

const TopoVpcNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoVpcNodeData;
  return (
    <div className={`topo-vpc ${d.isHub ? 'is-hub' : ''} ${d.isEndpoint ? 'is-endpoint' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Top} id="source-top" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <div className="topo-vpc-row">
        <Cloud size={13} />
        <span className="topo-vpc-name">{d.label.toUpperCase()}</span>
        {d.isHub && <span className="topo-badge hub">HUB</span>}
        {d.isEndpoint && <span className="topo-badge ep">EP</span>}
      </div>
      <div className="topo-vpc-cidr">{d.cidr}</div>
    </div>
  );
});

TopoVpcNode.displayName = 'TopoVpcNode';
export default TopoVpcNode;
