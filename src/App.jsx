import { Component, useEffect } from 'react';
import { AppProvider } from './context.jsx';
import { useRoute } from './lib/router.js';
import Home from './components/Home.jsx';
import NewTournament from './components/NewTournament.jsx';
import Tournament from './components/Tournament.jsx';

function Screen() {
  const route = useRoute();
  useEffect(() => {
    if (route.name !== 'tournament') document.title = route.name === 'new' ? 'Neues Turnier · Turnier Manager' : 'Turnier Manager';
  }, [route]);
  if (route.name === 'new') return <NewTournament />;
  if (route.name === 'tournament') return <Tournament key={route.id} id={route.id} />;
  return <Home />;
}

/** Fängt unerwartete Darstellungsfehler ab, damit nie ein leerer weisser Bildschirm bleibt. */
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app no-tabs">
        <h1 className="logo" style={{ marginTop: 40 }}>Hoppla</h1>
        <p className="error" role="alert" style={{ marginTop: 16 }}>
          Etwas ist schiefgelaufen. Bereits eingetragene Ergebnisse sind gespeichert, noch offene werden nach dem Neuladen automatisch nachgesendet.
        </p>
        <button className="btn" onClick={() => window.location.reload()}>Neu laden</button>
        <p className="center"><button className="link" onClick={() => { window.location.href = '/'; }}>Zur Startseite</button></p>
      </main>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Screen />
      </AppProvider>
    </ErrorBoundary>
  );
}
