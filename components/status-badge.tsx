interface Props {
  status: string | null;
}

export function StatusBadge({ status }: Props) {
  if (!status) return null;
  return <span className="pill" data-status={status}>{status}</span>;
}
