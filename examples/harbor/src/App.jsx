import { Button as Action, Badge, TextField, Avatar, Notice } from './components';
import mark from '../public/harbor-mark.svg';
import './styles.css';

export default function App() {
  return (
    <main>
      <img src={mark} alt="Harbor" />
      <Badge>New workspace</Badge>
      <h1>Welcome to Harbor.</h1>
      <p>Thoughtful tools for good work.</p>
      <TextField label="Workspace name" placeholder="My workspace" />
      <Action variant="primary" size="large">Get started</Action>
      <Notice>Your workspace is private.</Notice>
      <Avatar name="Alex" />
    </main>
  );
}
