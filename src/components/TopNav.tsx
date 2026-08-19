"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TopNav.module.css";

export function TopNav() {
  const path = usePathname() || "";

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/exam-prep/new", label: "New Reviewer" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/dashboard" className={styles.brand} aria-label="CloneQuizzAndReview home">
          <span className={styles.brandMark} aria-hidden="true">
            {"</>"}
          </span>
          <span className={styles.brandText}>
            CloneQuizz<span className={styles.brandDim}>AndReview</span>
          </span>
        </Link>

        <nav className={styles.navLinks} aria-label="Primary">
          {navItems.map((item) => {
            const active =
              item.href === "/dashboard"
                ? path === "/dashboard"
                : path.startsWith("/exam-prep/new") ||
                  path.startsWith("/exam-prep/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.active : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.actions}>
          <Link href="/exam-prep/new" className="btn btn-primary btn-small">
            + New Reviewer
          </Link>
        </div>
      </div>
    </header>
  );
}
