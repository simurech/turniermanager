import { useEffect } from 'react';
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

export default function App() {
  return (
    <AppProvider>
      <Screen />
    </AppProvider>
  );
}
