import Link from "next/link";
import Logo from "./Logo";
import styles from "./Header.module.css";

export default function Header({ tagline }: { tagline?: string }) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logoLink}>
        <Logo tagline={tagline} />
      </Link>
    </header>
  );
}
