import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Plug, Database } from 'lucide-react';

interface TopoEndpointNodeData {
  endpoints: string[];
  isGateway?: boolean;
}

const TopoEndpointNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoEndpointNodeData;
  const Icon = d.isGateway ? Database : Plug;
  const label = d.isGateway ? 'GW Endpoints' : 'Endpoints';

  return (
    <div className={`topo-endpoint ${d.isGateway ? 'is-gw' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <div className="topo-endpoint-header">
        <Icon size={11} />
        <span>{label}</span>
      </div>
      <div className="topo-endpoint-list">
        {d.endpoints.map((ep, i) => (
          <span key={i} className="topo-endpoint-tag">{ep}</span>
        ))}
      </div>
    </div>
  );
});

TopoEndpointNode.displayName = 'TopoEndpointNode';
export default TopoEndpointNode;
