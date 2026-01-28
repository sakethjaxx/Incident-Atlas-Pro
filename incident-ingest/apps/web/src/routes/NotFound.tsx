import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p>The page you requested does not exist.</p>
      <Link className="badge" to="/">
        Back to dashboard
      </Link>
    </section>
  );
}
