/// <reference types="@docusaurus/module-type-aliases" />
/// <reference types="@docusaurus/theme-classic" />
// The two references above are load-bearing from BOTH sides. A Docusaurus site
// gets these ambient declarations from its generated .docusaurus/ directory, but a
// consumer's `tsc` follows the re-export shim into this file and typechecks it with
// the CONSUMER's tsconfig, which has no reason to know about them. Declaring them
// here means neither the kit nor any content repo needs extra tsconfig setup.
/**
 * Shared workshop landing page. The only thing that differed between the three
 * repos was the meta description string, which now derives from siteConfig.title.
 */
import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './WorkshopHome.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/overview">
            Open Workshop Docs
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={`${siteConfig.title} documentation and exercises.`}>
      <HomepageHeader />
    </Layout>
  );
}
