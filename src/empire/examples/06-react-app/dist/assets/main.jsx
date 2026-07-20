// A small real React app — routed with React Router's BrowserRouter, which
// uses real URL paths (not #hash routes). That's deliberate: BrowserRouter
// is what actually needs server-side SPA fallback, since navigating directly
// to /about, or refreshing on it, sends a real "GET /about" to Empire.
const { useState, useEffect } = React;
const { BrowserRouter, Routes, Route, Link } = ReactRouterDOM;

function Nav() {
    return (
        <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
            <Link to="/users">Users</Link>
        </nav>
    );
}

function Home() {
    return (
        <div>
            <h1>Empire — React App Example</h1>
            <p>
                This page is served by Empire's static file handler at{" "}
                <code>GET /</code> — a real file, <code>dist/index.html</code>.
            </p>
            <p>
                Everything under <code>/</code> from here is client-side
                routing, handled by React Router, not Empire.
            </p>
        </div>
    );
}

function About() {
    return (
        <div>
            <h1>About</h1>
            <p>
                This route (<code>/about</code>) has no matching static file
                and no matching Empire route. Try refreshing this page, or
                opening <code>/about</code> directly in a new tab — Empire's{" "}
                <code>useStaticFiles(root, {"{"} spaFallback: true {"}"})</code>{" "}
                serves the same <code>index.html</code> shell for it instead
                of a 404, and React Router renders this page client-side once
                it loads.
            </p>
        </div>
    );
}

function Users() {
    const [users, setUsers] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetch("/api/users")
            .then((res) => res.json())
            .then((data) => setUsers(data.users))
            .catch((err) => setError(String(err)));
    }, []);

    return (
        <div>
            <h1>Users</h1>
            <p>
                Fetched from a real Empire route (<code>GET /api/users</code>),
                matched before the SPA fallback ever gets a chance to run.
            </p>
            {error && <p>Error: {error}</p>}
            {!users && !error && <p>Loading…</p>}
            {users && (
                <ul>
                    {users.map((user) => (
                        <li key={user.id}>{user.name}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function App() {
    return (
        <BrowserRouter>
            <Nav />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
                <Route path="/users" element={<Users />} />
            </Routes>
        </BrowserRouter>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
