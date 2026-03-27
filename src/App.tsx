import NetworkFlow from './components/NetworkFlow';
import './App.css';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>AWS Network Architecture Visualizer</h1>
        <p>Upload your network configuration JSON to visualize VPCs, Subnets, and Transit Gateways</p>
      </header>
      <main className="app-main">
        <NetworkFlow />
      </main>
    </div>
  );
}

export default App;
