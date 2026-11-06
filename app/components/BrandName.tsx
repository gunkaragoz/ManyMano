/** Two-tone wordmark for the default brand; any other SITE_NAME renders as plain text. */
export default function BrandName({ name }: { name: string }) {
  if (name.toLowerCase() === "manymano") {
    return (
      <>
        <span className="text-blue-600">{name.slice(0, 4)}</span>
        <span className="text-green-600">{name.slice(4)}</span>
      </>
    );
  }
  return <>{name}</>;
}
