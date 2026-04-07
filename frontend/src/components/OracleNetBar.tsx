import { useState, useEffect, useRef, useCallback } from 'react';
import { getOracleNetStatus, getOracleNetFeed, getOracleNetPresence } from '../api/oraclenet';
import styles from './OracleNetBar.module.css';

interface PresenceEntry {
  id: string;
  name: string;
  avatar?: string;
}

interface FeedEntry {
  id: string;
  author: string;
  content: string;
  created: string;
}

export function OracleNetBar() {
  const [online, setOnline] = useState(false);
  const [netUrl, setNetUrl] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [checked, setChecked] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if OracleNet is reachable
  useEffect(() => {
    getOracleNetStatus()
      .then(s => {
        setOnline(s.online);
        setNetUrl(s.url || '');
        setChecked(true);
      })
      .catch(() => {
        setOnline(false);
        setChecked(true);
      });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [presRes, feedRes] = await Promise.all([
        getOracleNetPresence(),
        getOracleNetFeed(5),
      ]);
      if (Array.isArray(presRes)) setPresence(presRes);
      else if (presRes?.items) setPresence(presRes.items);

      if (Array.isArray(feedRes)) setFeed(feedRes);
      else if (feedRes?.items) setFeed(feedRes.items);
    } catch {
      // Graceful degradation — keep last data
    }
  }, []);

  // Fetch data when expanded, poll every 60s
  useEffect(() => {
    if (expanded && online) {
      fetchData();
      pollRef.current = setInterval(fetchData, 60_000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [expanded, online, fetchData]);

  // Don't render anything if offline or not yet checked
  if (!checked || !online) return null;

  function getInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  if (!expanded) {
    return (
      <button className={styles.tab} onClick={() => setExpanded(true)}>
        <span className={styles.statusDot} />
        OracleNet
      </button>
    );
  }

  return (
    <>
      <div className={styles.overlay} onClick={() => setExpanded(false)} />
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <span className={styles.statusDot} />
            OracleNet
          </div>
          <button className={styles.closeBtn} onClick={() => setExpanded(false)}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Online Now</div>
            {presence.length === 0 ? (
              <div className={styles.empty}>No one online</div>
            ) : (
              <div className={styles.presenceList}>
                {presence.map(p => (
                  <div key={p.id} className={styles.presenceItem}>
                    <div className={styles.avatar}>
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.name} style={{ width: '100%', borderRadius: '50%' }} />
                      ) : (
                        getInitial(p.name)
                      )}
                    </div>
                    <span className={styles.presenceName}>{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Recent Posts</div>
            {feed.length === 0 ? (
              <div className={styles.empty}>No recent posts</div>
            ) : (
              <div className={styles.feedList}>
                {feed.slice(0, 5).map(item => (
                  <div key={item.id} className={styles.feedItem}>
                    <div className={styles.feedAuthor}>{item.author}</div>
                    <div className={styles.feedText}>{item.content}</div>
                    {item.created && (
                      <div className={styles.feedTime}>{timeAgo(item.created)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {netUrl && (
          <div className={styles.footer}>
            <a href={netUrl} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
              Open OracleNet &rarr;
            </a>
          </div>
        )}
      </div>
    </>
  );
}
