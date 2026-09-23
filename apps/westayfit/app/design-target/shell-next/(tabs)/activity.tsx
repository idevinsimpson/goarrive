import { ShellNextPage } from '../../../../src/ui/shellNext/ShellNextPage';

/** Stands for production `/activity` (the Progress destination). */
export default function ShellNextActivity() {
  return (
    <ShellNextPage
      id="activity"
      title="Your progress"
      lede="Stands in for the real Progress page. Its privacy copy and content are not this packet's."
    />
  );
}
