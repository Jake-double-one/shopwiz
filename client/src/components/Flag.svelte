<script module>
  // Flags from flag-icons (MIT, © Panayiotis Lipiridis) – only the countries travel mode knows,
  // shipped as files with the app: no external requests, same look on every system.
  const files = import.meta.glob('../../../node_modules/flag-icons/flags/4x3/{ad,ae,al,ar,at,au,ba,be,bg,br,by,ca,ch,cl,cn,co,cr,cu,cy,cz,de,dk,do,ee,eg,es,fi,fr,gb,ge,gr,hk,hr,hu,id,ie,il,in,is,it,jo,jp,ke,kr,li,lk,lt,lu,lv,ma,mc,md,me,mk,mt,mu,mv,mx,my,nl,no,nz,pe,ph,pl,pt,ro,rs,ru,sa,se,sg,si,sk,sm,th,tn,tr,tw,tz,ua,us,va,vn,za}.svg', {
    query: '?url',
    import: 'default',
    eager: true,
  });
  const urls = Object.fromEntries(Object.entries(files).map(([p, url]) => [p.slice(-6, -4).toUpperCase(), url]));
</script>

<script>
  /** country: ISO code like "IT"; label: accessible name (omit when the text next to it says it) */
  let { country, label = '', size = 18 } = $props();
  const url = $derived(urls[country]);
</script>

{#if url}
  <img class="flag" src={url} alt={label} title={label || undefined} width={Math.round(size * 4 / 3)} height={size} style:height="{size}px" />
{:else if country}
  <span class="flag code" aria-label={label || undefined}>{country}</span>
{/if}

<style>
  .flag {
    display: inline-block;
    flex: none;
    width: auto;
    border-radius: 2px;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 15%, transparent);
    vertical-align: -0.15em;
    object-fit: cover;
  }
  .code {
    font: 600 0.7rem/1 var(--mono);
    padding: 2px 3px;
  }
</style>
