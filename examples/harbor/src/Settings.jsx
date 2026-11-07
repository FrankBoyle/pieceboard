import { Button, Badge, TextField } from './components';

export function Settings() {
  return (
    <section>
      <h2>Workspace settings</h2>
      <Badge>Active</Badge>
      <TextField label="Display name" />
      <Button variant="quiet">Cancel</Button>
      <Button variant="primary">Save changes</Button>
    </section>
  );
}
