# AWS Network Architecture Visualizer

**English | [中文](README.md)**

A visualization tool for [AWS Cloud Foundations](https://www.amazonaws.cn/solutions/technology/cloud-foundations/) network architecture. It provides an interactive canvas to visualize and edit the network topology of Landing Zone multi-account environments, including VPCs, Subnets, Transit Gateway, Direct Connect, and other core networking resources.

## Screenshots

### Topo View

Multi-region network topology grouped by geography, with drag-to-move region support:

![Topo View](snapshoot/screenshot-20260328-015026.png)

### Detailed View

Full VPC internals — subnets, route tables, TGW routing policies — with an integrated JSON editor on the left:

![Detailed View](snapshoot/screenshot-20260328-015111.png)

## Features

### Multi-View Architecture Visualization

- **Detailed View** — Full VPC structure with subnets, route tables, and security components (IGW / NAT / NFW / GWLB)
- **Topo View** — High-level topology grouped by geography, focusing on inter-region connectivity and TGW peering
- **Mind Map** — Tree-structured overview for quick resource hierarchy browsing

### Networking Resource Support

- **VPC** — CIDR, Subnets (Public / Private / Intra), multi-account ownership
- **Transit Gateway** — ASN, CIDR, Route Tables (associations / propagations / static routes), Connect attachments
- **TGW Cross-Region Peering** — TGW peering between primary and peer regions
- **Direct Connect** — DX Gateway, ASN, advertised prefixes
- **VPC Peering** — Cross-VPC peering connections
- **Security Components** — Internet Gateway, NAT Gateway, Network Firewall, Gateway Load Balancer
- **Endpoints** — Interface Endpoints and Gateway Endpoints

### JSON Configuration Editor

- Integrated Monaco Editor panel for real-time JSON editing
- Click any canvas node to auto-navigate to the corresponding JSON path
- Live validation with automatic error and warning detection

### Resource Management Panel

- **VPC Creation Wizard** — Select peering targets and TGW route table associations
- **VPN Smart Connectivity Wizard** — Automatically analyzes TGW route tables when creating a Site-to-Site VPN, generates a connectivity plan showing which associations / propagations / routes to modify and why
- **Overlay Resources** — Add and visualize extended resources (VPN, DX, etc.) on the canvas
- **Change Log** — Automatically tracks JSON config changes and manual operations, displayed by category

### Interaction

- Click canvas nodes to highlight and sync JSON editor position
- Hover over TGW route table entries to highlight corresponding edges
- Drag region background boxes in Topo View to move entire regions
- Export canvas as PNG image
- Chinese / English language toggle

## Tech Stack

- **React 19** + **TypeScript 5.9**
- **@xyflow/react (React Flow)** — Canvas rendering and node/edge interaction
- **Monaco Editor** — JSON configuration editor
- **Vite 7** — Build tool
- **Lucide React** — Icon library
- **Zustand-style State Management** — Overlay resource state

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build
```

Open the app in your browser, then upload or paste a Landing Zone network configuration JSON to visualize it.

## JSON Configuration Structure

```jsonc
{
  "vpcs": {                    // Primary region VPC definitions
    "security": {
      "cidr": "10.0.0.0/24",
      "accounts": ["123456789012"],
      "subnets": { "public": {}, "private": {}, "intra": {} },
      "igw": { "enabled": true },
      "nat": { "enabled": true }
    }
  },
  "tgw": {                    // Primary region Transit Gateway
    "enabled": true,
    "asn": 64512,
    "cidr": "10.254.0.0/24",
    "tables": {
      "pre": { "associations": ["security"], "propagations": ["security"], "routes": {} },
      "post": { "associations": ["workload"], "propagations": ["workload"], "routes": {} }
    }
  },
  "dx": {                     // Direct Connect
    "enabled": true,
    "asn": 65000,
    "prefixes": ["10.0.0.0/8"]
  },
  "ap-southeast-1": {         // Peer region (region name as key)
    "vpcs": { ... },
    "tgw": { "enabled": true, "peer": true, ... }
  }
}
```

## Resources

- [AWS Cloud Foundations Solution](https://www.amazonaws.cn/solutions/technology/cloud-foundations/)
- [AWS Landing Zone Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/migration-aws-environment/welcome.html)
- [Amazon Transit Gateway Documentation](https://docs.aws.amazon.com/vpc/latest/tgw/)
- [Amazon VPC Documentation](https://docs.aws.amazon.com/vpc/)

## License

MIT
