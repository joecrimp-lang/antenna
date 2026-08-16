-- Run this once in the Supabase SQL editor for a new project.
-- Creates the three tables the app needs and seeds the fixed watchlist
-- of 50 media & entertainment companies.

create table if not exists companies (
  id bigint generated always as identity primary key,
  rank int not null,
  name text not null unique,
  website text,
  country text,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id bigint generated always as identity primary key,
  company_id bigint not null references companies (id) on delete cascade,
  summary text not null,
  detail text,
  source_url text,
  source_title text,
  published_date date,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  unique (company_id, source_url)
);

create table if not exists runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  companies_processed int not null default 0,
  signals_found int not null default 0,
  error text,
  cursor int not null default 0
);

create index if not exists signals_created_at_idx on signals (created_at desc);
create index if not exists signals_emailed_at_idx on signals (emailed_at);

insert into companies (rank, name, website, country) values
(1, 'The Walt Disney Company', 'thewaltdisneycompany.com', 'USA'),
(2, 'Netflix', 'netflix.com', 'USA'),
(3, 'NBCUniversal', 'nbcuniversal.com', 'USA'),
(4, 'Warner Bros. Discovery', 'wbd.com', 'USA'),
(5, 'Paramount', 'paramount.com', 'USA'),
(6, 'Amazon MGM Studios / Prime Video', 'amazonmgmstudios.com', 'USA'),
(7, 'Apple TV', 'tv.apple.com', 'USA'),
(8, 'YouTube', 'youtube.com', 'USA'),
(9, 'BBC', 'bbc.com', 'UK'),
(10, 'BBC Studios', 'bbcstudios.com', 'UK'),
(11, 'Sky', 'skygroup.sky', 'UK'),
(12, 'ITV', 'itv.com', 'UK'),
(13, 'ITV Studios', 'itvstudios.com', 'UK'),
(14, 'Channel 4', 'channel4.com', 'UK'),
(15, 'Banijay Entertainment', 'banijay.com', 'UK / France'),
(16, 'Fremantle', 'fremantle.com', 'UK / Germany'),
(17, 'RTL Group', 'rtl.com', 'Luxembourg'),
(18, 'ProSiebenSat.1 Media', 'prosiebensat1.com', 'Germany'),
(19, 'ARD', 'ard.de', 'Germany'),
(20, 'ZDF', 'zdf.de', 'Germany'),
(21, 'France Télévisions', 'francetelevisions.fr', 'France'),
(22, 'CANAL+', 'canalplusgroup.com', 'France'),
(23, 'TF1 Group', 'groupe-tf1.fr', 'France'),
(24, 'Mediawan', 'mediawan.com', 'France'),
(25, 'RAI', 'rai.it', 'Italy'),
(26, 'Mediaset / MFE', 'mfemediaforeurope.com', 'Italy'),
(27, 'Telefónica / Movistar Plus+', 'telefonica.com', 'Spain'),
(28, 'Viaplay Group', 'viaplaygroup.com', 'Sweden'),
(29, 'Schibsted', 'schibsted.com', 'Norway'),
(30, 'DPG Media', 'dpgmediagroup.com', 'Belgium / Netherlands'),
(31, 'DAZN', 'dazngroup.com', 'UK'),
(32, 'ESPN', 'espn.com', 'USA'),
(33, 'Fox Corporation', 'foxcorporation.com', 'USA'),
(34, 'CBS Sports', 'cbssports.com', 'USA'),
(35, 'NBC Sports', 'nbcsports.com', 'USA'),
(36, 'beIN Media Group', 'beinmediagroup.com', 'Qatar'),
(37, 'Formula 1', 'formula1.com', 'UK'),
(38, 'UEFA', 'uefa.com', 'Switzerland'),
(39, 'FIFA', 'fifa.com', 'Switzerland'),
(40, 'Premier League', 'premierleague.com', 'UK'),
(41, 'ATP Media', 'atpmedia.tv', 'UK'),
(42, 'IMG', 'img.com', 'USA'),
(43, 'NEP Group', 'nepgroup.com', 'USA'),
(44, 'Sony Pictures Entertainment', 'sonypictures.com', 'USA'),
(45, 'Lionsgate', 'lionsgate.com', 'USA'),
(46, 'CJ ENM', 'cjenm.com', 'South Korea'),
(47, 'NHK', 'nhk.or.jp', 'Japan'),
(48, 'Sony Group', 'sony.com', 'Japan'),
(49, 'Nine Entertainment', 'nineforbrands.com.au', 'Australia'),
(50, 'Globo', 'globo.com', 'Brazil')
on conflict (name) do nothing;
