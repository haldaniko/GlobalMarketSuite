import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Check,
  Clock,
  Download,
  FilePlus,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { absoluteApiUrl, createBookCheckout, getBook, getBookOrderStatus, getPost, getPosts, request, subscribe } from './api';
import type { BookProduct } from './api';
import type { AdminSettings, Article, Post } from './domain';

const coverFallback = '/covers/market-map.svg';
const weekdays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

type DraftPost = {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  coverImage: string;
  status: 'draft' | 'published';
  tags: string;
};

type Session = {
  token: string;
  csrfToken: string;
  email: string;
};

const emptyDraft: DraftPost = {
  title: '',
  slug: '',
  excerpt: '',
  contentHtml: '<h2>The Contrarian Opening</h2><p></p>',
  coverImage: coverFallback,
  status: 'published',
  tags: '',
};

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('app:navigate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToBook() {
  if (window.location.pathname !== '/') navigate('/#book');
  window.setTimeout(() => document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
}

function SocialIcon({ name }: { name: "x" | "threads" | "telegram" | "linkedin" }) {
  if (name === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.244 2H21.5l-7.11 8.126L22.75 22h-6.54l-5.12-6.693L5.23 22H1.97l7.605-8.692L1.55 2h6.705l4.627 6.118L18.244 2Zm-1.143 17.91h1.804L7.27 3.98H5.334L17.1 19.91Z" />
      </svg>
    );
  }
  if (name === "threads") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.08 2C7.02 2 4 5.36 4 10.93v2.14C4 18.64 7.02 22 12.08 22c4.38 0 7.13-2.28 7.13-5.86 0-2.58-1.48-4.2-4.2-4.82-.16-2.32-1.53-3.77-3.88-3.77-1.5 0-2.76.52-3.73 1.55l1.22 1.42c.67-.7 1.46-1.05 2.37-1.05 1.1 0 1.78.62 1.94 1.74h-1.44c-2.72 0-4.41 1.3-4.41 3.38 0 2 1.55 3.3 3.94 3.3 2.35 0 3.82-1.2 4.14-3.45 1.26.45 1.9 1.24 1.9 2.37 0 2.02-1.88 3.29-4.88 3.29-3.82 0-5.99-2.48-5.99-6.9v-2.24c0-4.42 2.17-6.9 5.99-6.9 2.98 0 4.84 1.38 5.28 3.9h2.1C19.03 4.43 16.32 2 12.08 2Zm-1 13.96c-1.13 0-1.82-.52-1.82-1.36 0-.92.83-1.46 2.27-1.46h1.48c-.17 1.84-.83 2.82-1.93 2.82Z" />
      </svg>
    );
  }
  if (name === "telegram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.74 4.67 18.5 19.95c-.24 1.08-.88 1.34-1.78.84l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.98.48l.35-5.02 9.13-8.25c.4-.35-.09-.55-.62-.2L6.03 13.56 1.17 12.04c-1.05-.33-1.07-1.05.22-1.55L20.4 3.16c.88-.33 1.65.2 1.34 1.51Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5ZM.33 8h4.33v14H.33V8Zm7 0h4.15v1.92h.06c.58-1.1 2-2.25 4.1-2.25 4.38 0 5.19 2.88 5.19 6.63V22H16.5v-6.82c0-1.63-.03-3.72-2.27-3.72-2.27 0-2.62 1.77-2.62 3.6V22H7.33V8Z" />
    </svg>
  );
}

function ShareBar({ title, url }: { title: string; url: string }) {
  const absoluteUrl = typeof window !== "undefined" ? new URL(url, window.location.origin).href : url;
  const shareText = `${title} ${absoluteUrl}`;
  const encodedUrl = encodeURIComponent(absoluteUrl);
  const encodedTitle = encodeURIComponent(title);
  const encodedShareText = encodeURIComponent(shareText);
  const targets = [
    { label: "X", icon: "x" as const, href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}` },
    { label: "Threads", icon: "threads" as const, href: `https://www.threads.net/intent/post?text=${encodedShareText}` },
    { label: "Telegram", icon: "telegram" as const, href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}` },
    { label: "LinkedIn", icon: "linkedin" as const, href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
  ];

  return (
    <aside className="share-bar" aria-label="Share this post">
      <span className="share-label">Share this post</span>
      <div className="share-actions">
        {targets.map((target) => (
          <a key={target.label} className="share-link" href={target.href} target="_blank" rel="noreferrer" aria-label={`Share on ${target.label}`}>
            <SocialIcon name={target.icon} />
            <span>{target.label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}


function readingTime(html: string) {
  return Math.max(4, Math.ceil(html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length / 210));
}

function toArticle(post: Post, index = 0): Article {
  return {
    ...post,
    coverImage: post.coverImage || coverFallback,
    category: post.source === 'bot' ? 'Market Intelligence' : post.tags[0] || (post.source === 'ai' ? 'Market Intelligence' : 'Strategy'),
    readingTime: readingTime(post.contentHtml),
    views: 3200 + index * 370,
  };
}

function clampGenerationCount(value: number) {
  return Math.min(12, Math.max(1, Number.isFinite(value) ? value : 1));
}

function defaultTimeForIndex(index: number) {
  const hour = (8 + index * 2) % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

function normalizeGenerationTimes(times: string[], count: number) {
  return Array.from({ length: count }, (_, index) => times[index] || defaultTimeForIndex(index));
}

function Header() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <button className="brand" onClick={() => navigate('/')}>
          <span className="brand-mark">GMS</span>
          <span>GlobalMarketSuite</span>
        </button>
        <nav className="nav">
          <button onClick={() => navigate('/articles')}>Intelligence</button>
          <button onClick={scrollToBook}>Book</button>
          <button onClick={() => navigate('/about')}>About</button>
        </nav>
      </div>
    </header>
  );
}

function BookSection() {
  const [book, setBook] = useState<BookProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getBook().then(setBook).catch((err) => setError(err instanceof Error ? err.message : 'Could not load the book.'));
  }, []);

  async function buy() {
    setBusy(true);
    setError('');
    try {
      const { checkoutUrl } = await createBookCheckout();
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout is temporarily unavailable.');
      setBusy(false);
    }
  }

  const price = book
    ? new Intl.NumberFormat('en', { style: 'currency', currency: book.currency.toUpperCase() }).format(book.amountCents / 100)
    : '—';

  return (
    <section className="book-section" id="book">
      <div className="shell book-grid">
        <div className="book-stage" aria-hidden="true">
          <div className="book-cover">
            <span className="book-kicker">GLOBAL MARKET SUITE</span>
            <strong>{book?.title || '[НАЗВАНИЕ КНИГИ]'}</strong>
            <span className="book-cover-rule" />
            <span className="book-author">{book?.author || '[ИМЯ АВТОРА]'}</span>
          </div>
        </div>
        <div className="book-copy">
          <p className="overline">The field guide</p>
          <h2>{book?.title || '[НАЗВАНИЕ КНИГИ]'}</h2>
          <p className="book-byline">by {book?.author || '[ИМЯ АВТОРА]'}</p>
          <p className="book-lede">
            A practical, contrarian playbook for seeing demand shifts earlier, turning behavioral insight into sharper strategy,
            and building market ideas people actually remember.
          </p>
          <ul className="book-benefits">
            <li><Check size={18} /> Spot overlooked behavioral signals before competitors do.</li>
            <li><Check size={18} /> Translate consumer psychology into clear strategic moves.</li>
            <li><Check size={18} /> Pressure-test positioning with reusable frameworks.</li>
            <li><Check size={18} /> Make AI and market change useful instead of noisy.</li>
          </ul>
          <div className="book-purchase">
            <div><span>Digital edition</span><strong>{price}</strong></div>
            <button className="btn primary book-buy" onClick={buy} disabled={busy || !book}>
              <BookOpen size={18} /> {busy ? 'Opening checkout…' : 'Buy the book'}
            </button>
          </div>
          <div className="book-assurance">
            <span><ShieldCheck size={17} /> Secure payment via Stripe</span>
            <span><Download size={17} /> PDF · instant access after payment</span>
          </div>
          {error && <p className="error notice">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function Newsletter() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await subscribe(email);
      setEmail('');
      setMessage('Subscribed. The next market signal will find you.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not subscribe right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="newsletter-form" onSubmit={submit}>
      <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="strategist@company.com" required disabled={busy} />
      <button disabled={busy}>{busy ? 'Subscribing' : 'Subscribe'}</button>
      {message && <p className={message.includes('Subscribed') ? 'success' : 'error'}>{message}</p>}
    </form>
  );
}

function ArticleCard({ article, featured = false }: { article: Article; featured?: boolean }) {
  return (
    <article
      className={`article-card ${featured ? 'featured-card' : ''}`}
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/articles/${article.slug}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/articles/${article.slug}`);
        }
      }}
    >
      <img src={article.coverImage || coverFallback} alt="" />
      <div className="card-copy">
        <div className="eyebrow-row">
          <span>{article.category}</span>
          <span><Clock size={14} /> {article.readingTime} min</span>
        </div>
        <h3>{article.title}</h3>
        <p>{article.excerpt}</p>
      </div>
    </article>
  );
}

function HomePage({ articles }: { articles: Article[] }) {
  const lead = articles[0];
  const rest = articles.slice(1, 7);

  return (
    <>
      <section className="hero">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <p className="overline">Ioana The Best Inc. / Marketing Intelligence</p>
            <h1>Marketing ideas for people who are already bored by marketing ideas.</h1>
            <p>
              Contrarian essays on consumer psychology, attention markets, brand power, AI transformation,
              and the economic forces quietly changing what people choose.
            </p>
            <div className="hero-actions">
              <button className="btn primary" onClick={() => navigate('/articles')}>Read The Signals</button>
              <button className="btn ghost" onClick={() => navigate('/about')}>About Ioana</button>
            </div>
          </div>
          <aside className="signal-board">
            <div>
              <span className="board-label">Current Thesis</span>
              <h2>Desire now moves faster than positioning decks.</h2>
            </div>
            <div className="signal-grid">
              <span>Behavioral economics</span>
              <span>Brand strategy</span>
              <span>AI demand shifts</span>
              <span>Consumer irrationality</span>
            </div>
          </aside>
        </div>
      </section>

      <main className="shell section">
        <div className="section-head">
          <div>
            <p className="overline">Latest Intelligence</p>
            <h2>Signals worth stealing before they become obvious.</h2>
          </div>
          <Newsletter />
        </div>
        {lead && <ArticleCard article={lead} featured />}
        <div className="article-grid">
          {rest.map((article) => <ArticleCard key={article.id} article={article} />)}
        </div>
      </main>
      <BookSection />
    </>
  );
}

function BookSuccessPage() {
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [state, setState] = useState<'checking' | 'pending' | 'paid' | 'error'>('checking');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [message, setMessage] = useState('Confirming your payment with Stripe…');

  useEffect(() => {
    if (!sessionId) {
      setState('error');
      setMessage('This page is missing its Checkout Session ID.');
      return;
    }
    let cancelled = false;
    let attempts = 0;
    async function check() {
      try {
        const result = await getBookOrderStatus(sessionId as string);
        if (cancelled) return;
        if (result.status === 'paid' && result.downloadUrl) {
          setDownloadUrl(absoluteApiUrl(result.downloadUrl));
          setState('paid');
          setMessage('Payment confirmed. Your private download is ready.');
          return;
        }
        attempts += 1;
        setState('pending');
        setMessage('Payment is still processing. This page will check again automatically.');
        if (attempts < 15) window.setTimeout(check, 2000);
      } catch (error) {
        if (cancelled) return;
        setState('error');
        setMessage(error instanceof Error ? error.message : 'We could not verify this payment.');
      }
    }
    void check();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <main className="shell purchase-result">
      <div className={`purchase-card ${state}`}>
        <span className="purchase-icon">{state === 'paid' ? <Check size={30} /> : <BookOpen size={30} />}</span>
        <p className="overline">Digital book</p>
        <h1>{state === 'paid' ? 'Thank you for your purchase.' : state === 'error' ? 'We could not verify the order.' : 'Checking your payment.'}</h1>
        <p>{message}</p>
        {state === 'paid' && <a className="btn primary" href={downloadUrl}><Download size={18} /> Download PDF</a>}
        {state === 'pending' && <span className="payment-spinner" aria-label="Checking payment" />}
        {state === 'error' && <button className="btn ghost" onClick={scrollToBook}>Return to the book</button>}
        {state === 'paid' && <small>The signed link expires after 24 hours. You can revisit this page to generate a fresh link for this order.</small>}
      </div>
    </main>
  );
}

function PrivacyPage() {
  return (
    <main className="shell legal-page">
      <section className="page-intro">
        <p className="overline">Legal</p>
        <h1>Privacy Policy</h1>
        <p>How GlobalMarketSuite handles publication, subscription, and digital-book purchase data.</p>
      </section>
      <article className="prose legal-copy">
        <h2>Digital purchases</h2>
        <p>For a book order, we store the buyer email supplied through Stripe Checkout, the Stripe Checkout Session ID, Payment Intent ID, purchase amount, currency, payment status, and order timestamps. We use this information to confirm payment, prevent duplicate fulfilment, support the purchase, and issue a temporary download link.</p>
        <h2>Payment processing</h2>
        <p>Payment-card details are collected and processed directly by Stripe. GlobalMarketSuite does not receive or store full card numbers, security codes, or other card credentials. Stripe processes this data under its own privacy terms.</p>
        <h2>Retention and security</h2>
        <p>Order records are retained for operational, accounting, fraud-prevention, and legal purposes. The book file is kept outside public web directories, and download links are signed, time-limited, and available only for paid orders.</p>
        <h2>Contact</h2>
        <p>For privacy questions or requests concerning your personal data, contact the GlobalMarketSuite publisher using the contact details shown on this site.</p>
      </article>
    </main>
  );
}

function ArticlesPage({ articles }: { articles: Article[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    if (!term) return articles;
    return articles.filter((article) => [article.title, article.excerpt, article.category, ...article.tags].join(' ').toLowerCase().includes(term));
  }, [articles, query]);

  return (
    <main className="shell archive-page">
      <section className="page-intro">
        <p className="overline">Archive</p>
        <h1>Essays, frameworks, and market provocations.</h1>
        <label className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search brands, biases, AI, attention..." />
        </label>
      </section>
      <div className="article-grid">
        {filtered.map((article) => <ArticleCard key={article.id} article={article} />)}
      </div>
    </main>
  );
}

function ArticlePage({ article }: { article?: Article }) {
  if (!article) {
    return (
      <main className="shell page-intro">
        <h1>Article not found.</h1>
        <button className="btn primary" onClick={() => navigate('/articles')}>Back to archive</button>
      </main>
    );
  }

  return (
    <main className="article-detail">
      <section className="shell article-masthead">
        <p className="overline">{article.category}</p>
        <h1>{article.title}</h1>
        <p>{article.excerpt}</p>
        <div className="article-meta">
          <span>Ioana The Best Inc.</span>
          <span>{article.readingTime} min read</span>
          <span>{new Date(article.createdAt).toLocaleDateString()}</span>
        </div>
      </section>
      <img className="detail-cover" src={article.coverImage || coverFallback} alt="" />
      <div className="shell prose share-shell">
        <ShareBar title={article.title} url={`/articles/${article.slug}`} />
      </div>
      <article className="shell prose" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
    </main>
  );
}

function AboutPage() {
  return (
    <main className="shell about-page">
      <section className="page-intro">
        <p className="overline">About</p>
        <h1>GlobalMarketSuite studies markets as if consumers were human, which remains unfashionably useful.</h1>
      </section>
      <div className="about-grid">
        <div className="about-panel">
          <h2>Ioana The Best Inc.</h2>
          <p>
            A premium marketing intelligence publication exploring the intersection of consumer psychology,
            behavioral economics, brand strategy, cultural movement, and emerging economic change.
          </p>
        </div>
        <div className="about-panel quiet">
          <h2>Editorial Bias</h2>
          <p>
            We prefer named concepts over vague trends, brand evidence over slogans, and useful disagreement
            over content that politely evaporates five minutes after reading.
          </p>
        </div>
      </div>
    </main>
  );
}

function LoginPanel({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('admin@globalmarketsuite.local');
  const [password, setPassword] = useState('MySecretPassword123!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await request<{ user: { email: string }; accessToken: string; csrfToken: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onLogin({ token: data.accessToken, csrfToken: data.csrfToken, email: data.user.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-login" onSubmit={submit}>
      <p className="overline">Control Room</p>
      <h1>Editorial control room</h1>
      <label><span>Email</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></label>
      <label><span>Password</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
    </form>
  );
}

function AdminPanel({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<DraftPost>(emptyDraft);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAdminData() {
    const [adminPosts, adminSettings] = await Promise.all([
      request<Post[]>('/api/admin/posts', {}, session.token, session.csrfToken),
      request<AdminSettings>('/api/admin/settings', {}, session.token, session.csrfToken),
    ]);
    setPosts(adminPosts);
    setSettings(adminSettings);
  }

  useEffect(() => {
    loadAdminData().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load admin data'));
  }, []);

  function handleAdminError(error: unknown, fallback: string) {
    const text = error instanceof Error ? error.message : fallback;
    if (text.toLowerCase().includes('csrf')) {
      setMessage('Session changed. Please sign in again.');
      window.setTimeout(onLogout, 900);
      return;
    }
    setMessage(text);
  }

  function edit(post: Post) {
    setEditingSlug(post.slug);
    setDraft({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImage: post.coverImage || coverFallback,
      status: post.status,
      tags: post.tags.join(', '),
    });
  }

  async function savePost(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const payload = { ...draft, tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
    try {
      await request<Post>(editingSlug ? `/api/admin/posts/${editingSlug}` : '/api/admin/posts', {
        method: editingSlug ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }, session.token, session.csrfToken);
      setDraft(emptyDraft);
      setEditingSlug(null);
      await loadAdminData();
      setMessage('Article saved.');
    } catch (error) {
      handleAdminError(error, 'Could not save article');
    } finally {
      setBusy(false);
    }
  }

  async function deleteArticle(slug: string) {
    setBusy(true);
    try {
      await request(`/api/admin/posts/${slug}`, { method: 'DELETE' }, session.token, session.csrfToken);
      await loadAdminData();
      setMessage('Article deleted.');
    } catch (error) {
      handleAdminError(error, 'Could not delete article');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await request<AdminSettings>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }, session.token, session.csrfToken);
      setSettings(updated);
      setMessage('Generation settings saved.');
    } catch (error) {
      handleAdminError(error, 'Could not save settings');
    } finally {
      setBusy(false);
    }
  }

  function updateGenerationCount(value: number) {
    if (!settings) return;
    const generationCount = clampGenerationCount(value);
    const generationTimes = normalizeGenerationTimes(settings.generationTimes, generationCount);
    setSettings({
      ...settings,
      generationCount,
      generationTimes,
      generationTime: generationTimes[0],
    });
  }

  function updateGenerationTime(index: number, time: string) {
    if (!settings) return;
    const generationTimes = normalizeGenerationTimes(settings.generationTimes, settings.generationCount);
    generationTimes[index] = time;
    setSettings({
      ...settings,
      generationTimes,
      generationTime: generationTimes[0],
    });
  }

  async function generateNow(count = 1) {
    setBusy(true);
    setMessage('');
    try {
      await request<Post[]>('/api/ai/generate-article', {
        method: 'POST',
        body: JSON.stringify({ count }),
      }, session.token, session.csrfToken);
      await loadAdminData();
      setMessage(count === 1 ? 'One article generated.' : `${count} articles generated.`);
    } catch (error) {
      handleAdminError(error, 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST' }, session.token, session.csrfToken).catch(() => null);
    onLogout();
  }

  return (
    <main className="admin-shell">
      <section className="admin-top">
        <div>
          <p className="overline">Signed in as {session.email}</p>
          <h1>GlobalMarketSuite admin</h1>
        </div>
        <button className="icon-btn" onClick={logout} title="Logout"><LogOut size={18} /></button>
      </section>
      {message && <p className={message.includes('saved') || message.includes('generated') || message.includes('deleted') ? 'success notice' : 'error notice'}>{message}</p>}
      <div className="admin-grid">
        <section className="admin-panel">
          <h2><FilePlus size={20} /> {editingSlug ? 'Edit article' : 'Create article'}</h2>
          <form className="editor-form" onSubmit={savePost}>
            <label><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
            <label><span>Slug</span><input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
            <label><span>Excerpt</span><textarea value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} required /></label>
            <label><span>Cover image</span><input value={draft.coverImage} onChange={(event) => setDraft({ ...draft, coverImage: event.target.value })} /></label>
            <label><span>Tags</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Brand Strategy, AI, Behavioral Economics" /></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as DraftPost['status'] })}><option value="published">Published</option><option value="draft">Draft</option></select></label>
            <label><span>HTML content</span><textarea className="html-editor" value={draft.contentHtml} onChange={(event) => setDraft({ ...draft, contentHtml: event.target.value })} required /></label>
            <div className="button-row">
              <button className="btn primary" disabled={busy}><Save size={16} /> Save</button>
              <button type="button" className="btn ghost" onClick={() => { setDraft(emptyDraft); setEditingSlug(null); }}>New</button>
            </div>
          </form>
        </section>

        <section className="admin-panel">
          <h2><Settings size={20} /> AI generation</h2>
          {settings && (
            <div className="settings-form">
              <label className="toggle"><input type="checkbox" checked={settings.autoGenerationEnabled} onChange={(event) => setSettings({ ...settings, autoGenerationEnabled: event.target.checked })} /> Auto generation enabled</label>
              <label><span>Mode</span><select value={settings.generationMode} onChange={(event) => setSettings({ ...settings, generationMode: event.target.value as AdminSettings['generationMode'], generationFrequency: event.target.value as AdminSettings['generationFrequency'] })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              <label><span>Generations per day</span><input type="number" min="1" max="12" value={settings.generationCount} onChange={(event) => updateGenerationCount(Number(event.target.value))} /></label>
              <div className="time-list">
                <span>Generation times</span>
                {normalizeGenerationTimes(settings.generationTimes, settings.generationCount).map((time, index) => (
                  <label key={index} className="time-row">
                    <span>#{index + 1}</span>
                    <input type="time" value={time} onChange={(event) => updateGenerationTime(index, event.target.value)} />
                  </label>
                ))}
              </div>
              <div className="weekday-row">
                {weekdays.map((day) => (
                  <button key={day.value} type="button" className={settings.generationWeekdays.includes(day.value) ? 'active' : ''} onClick={() => {
                    const exists = settings.generationWeekdays.includes(day.value);
                    setSettings({ ...settings, generationWeekdays: exists ? settings.generationWeekdays.filter((value) => value !== day.value) : [...settings.generationWeekdays, day.value] });
                  }}>{day.label}</button>
                ))}
              </div>
              <label><span>Master prompt</span><textarea className="prompt-editor" value={settings.masterPrompt} onChange={(event) => setSettings({ ...settings, masterPrompt: event.target.value })} /></label>
              <div className="button-row">
                <button type="button" className="btn primary" disabled={busy} onClick={saveSettings}><Save size={16} /> Save settings</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => generateNow(1)}><Sparkles size={16} /> {busy ? 'Generating...' : 'Generate 1 now'}</button>
                {settings.generationCount > 1 && (
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => generateNow(settings.generationCount)}><RefreshCw size={16} /> {busy ? 'Generating...' : `Generate ${settings.generationCount} now`}</button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="admin-panel post-list-panel">
        <h2><BarChart3 size={20} /> Articles</h2>
        <div className="admin-post-list">
          {posts.map((post) => (
            <article key={post.id}>
              <div>
                <strong>{post.title}</strong>
                <span>{post.status} / {post.source} / {post.slug}</span>
              </div>
              <button className="btn ghost" onClick={() => edit(post)}>Edit</button>
              <button className="icon-btn danger" onClick={() => deleteArticle(post.slug)} title="Delete"><Trash2 size={17} /></button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  return session ? <AdminPanel session={session} onLogout={() => setSession(null)} /> : <main className="shell admin-page"><LoginPanel onLogin={setSession} /></main>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Post | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener('app:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('app:navigate', update);
    };
  }, []);

  useEffect(() => {
    if (path === '/' && window.location.hash === '#book') {
      window.setTimeout(() => document.getElementById('book')?.scrollIntoView({ block: 'start' }), 80);
    }
  }, [path]);

  useEffect(() => {
    getPosts().then(setPosts).catch((err) => setError(err instanceof Error ? err.message : 'Could not load articles'));
  }, []);

  useEffect(() => {
    const match = path.match(/^\/articles\/([^/]+)$/);
    if (!match) {
      setSelected(null);
      return;
    }
    getPost(match[1]).then(setSelected).catch(() => setSelected(null));
  }, [path]);

  const articles = useMemo(() => posts.map(toArticle), [posts]);
  const selectedArticle = selected ? toArticle(selected) : articles.find((article) => path === `/articles/${article.slug}`);

  return (
    <>
      <Header />
      {error && <div className="shell error notice">{error}</div>}
      {path === '/' && <HomePage articles={articles} />}
      {path === '/articles' && <ArticlesPage articles={articles} />}
      {path.startsWith('/articles/') && <ArticlePage article={selectedArticle} />}
      {path === '/about' && <AboutPage />}
      {path === '/privacy' && <PrivacyPage />}
      {path === '/book/success' && <BookSuccessPage />}
      {path === '/admin' && <AdminPage />}
      <footer className="site-footer">
        <div className="shell">
          <span>GlobalMarketSuite</span>
          <span>Marketing intelligence by Ioana The Best Inc.</span>
          <button className="footer-link" onClick={() => navigate('/privacy')}>Privacy</button>
        </div>
      </footer>
    </>
  );
}
