# Analista Live

Ferramenta de observação e registo de eventos em direto para analistas de futebol.
PWA offline-first em JavaScript puro (sem framework, sem passo de build).

## Correr localmente

Qualquer servidor estático serve. Por exemplo:

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicar (Netlify)

O repositório está ligado ao Netlify — cada `git push` para `main` faz deploy
automático. O `netlify.toml` publica a raiz tal como está (site estático).

Ao alterar JS/CSS, **incrementa `CACHE_VERSION` em `sw.js`** para os dispositivos
já instalados apanharem a nova versão.

## Estrutura

- `index.html` — carrega os scripts por ordem; sem módulos, globais em `window`
- `js/core/` — base de dados (IndexedDB), estado, cronómetro, migrações, estatísticas
- `js/sync/` — sincronização multi-dispositivo (Supabase / BroadcastChannel local)
- `js/ui/` — ecrãs (router por `#hash` em `js/app.js`)
- `js/export/` — relatórios PDF (pdf-lib, incluída localmente)
- `sw.js` — service worker (app shell em cache para funcionar offline)
- `supabase-setup.sql` — cria a tabela e as políticas RLS para a sincronização

## Sincronização

O modelo de dados verdadeiro é o IndexedDB de cada dispositivo. O Supabase é
apenas um canal de entrega com histórico. A chave **anon** é pública por
desenho; nunca usar a `service_role`. Configuração em Definições → Sincronização.
