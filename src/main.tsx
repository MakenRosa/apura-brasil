import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class AppBoundary extends React.Component<React.PropsWithChildren, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <main style={{ maxWidth: 700, margin: '10vh auto', padding: 32, fontFamily: 'system-ui' }}><h1>Apura Brasil</h1><p>Não foi possível abrir o painel. Seus dados oficiais e favoritos permanecem salvos.</p><button onClick={() => location.reload()}>Recarregar aplicação</button></main>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>);
