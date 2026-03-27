import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { User } from 'lucide-react';

interface TopoAccountNodeData {
  accountId: string;
}

const TopoAccountNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoAccountNodeData;
  return (
    <div className="topo-account">
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <User size={11} />
      <span className="topo-account-id">{d.accountId}</span>
    </div>
  );
});

TopoAccountNode.displayName = 'TopoAccountNode';
export default TopoAccountNode;
