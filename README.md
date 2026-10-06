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

## Espelho da Equipa (consulta 24/7)

Uma cópia permanente do que está no iPad do analista, para a equipa técnica
consultar a qualquer hora (`js/sync/mirror.js`, `js/ui/mirrorUI.js`).

- Configurar uma vez: correr `supabase-espelho.sql` no SQL Editor do mesmo
  projeto Supabase. Depois, no iPad do analista: Definições → Equipa técnica →
  Ativar, e partilhar o link.
- Quem abre o link fica em modo consulta (só leitura) e o aparelho lembra-se:
  não há código para voltar a escrever.
- Uma linha por registo, substituída quando muda (não cresce a cada golo); o
  jogo vai sem as fotos do `teamSnapshot`. Uma época fica nas dezenas de MB.
- A chave de escrita fica só no iPad do analista; a de leitura vai no link e
  pode ser mudada (quem tinha o link antigo deixa de ver).

