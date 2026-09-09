/**
 * transportSupabase.js — Transporte pela nuvem (Supabase).
 *
 * É este que liga dois iPads em REDES DIFERENTES. Usa uma única tabela de
 * eventos (`sync_events`) como registo append-only e o Realtime do Supabase
 * para entregar as novidades sem polling.
 *
 * Porquê uma tabela só, em vez de espelhar todas as entidades no servidor:
 *  - o modelo de dados verdadeiro continua a ser o IndexedDB do analista;
 *  - o servidor é apenas um canal de entrega com histórico (permite a quem
 *    entra a meio recuperar tudo o que já aconteceu);
 *  - reduz drasticamente a superfície de erro e de conflitos.
 *
 * NOTA DE SEGURANÇA: a `anon key` do Supabase é pública por desenho — vai
 * sempre no cliente e não é um segredo. Quem protege os dados são as políticas
 * RLS (ver supabase-setup.sql). A `service_role key` NUNCA pode aparecer aqui.
 *
 * Carrega a biblioteca do Supabase a partir do CDN só quando é preciso, para
 * não pesar no arranque nem quebrar o funcionamento offline da aplicação.
 */

const TransportSupabase = {
  name: 'supabase',
  client: null,
  _channel: null,
  _code: null,
  _onMessage: null,
  _onStatus: null,
  CDN: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',

  /** Configuração guardada localmente (Definições → Sincronização). */
  async getConfig() {
    const s = await DB.get(DB.STORES.settings, 'app');
    return { url: this.normalizeUrl(s?.supabaseUrl), anonKey: (s?.supabaseAnonKey || '').trim() };
  },

  /**
   * Normaliza o URL do projeto. Erros comuns ao colar do painel:
   *  - barra no fim  -> gera "//rest/v1/..." e o servidor responde
   *    "Invalid path specified in request URL";
   *  - colar o endereço do DASHBOARD em vez do da API;
   *  - espaços invisíveis vindos do copiar/colar no iPad.
   * Reduzimos sempre ao esquema + domínio, que é o que a biblioteca espera.
   */
  normalizeUrl(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      // Se colaram o painel (supabase.com/dashboard/project/REF), reconstruímos
      // o endereço real da API a partir da referência do projeto.
      const m = u.pathname.match(/\/project\/([a-z0-9]+)/i);
      if (/supabase\.com$/i.test(u.hostname) && m) return `https://${m[1]}.supabase.co`;
      return u.origin; // descarta caminho, barra final e parâmetros
    } catch (e) {
      return v.replace(/\/+$/, '');
    }
  },

  async isConfigured() {
    const c = await this.getConfig();
    return !!(c.url && c.anonKey);
  },

  async _ensureClient() {
    if (this.client) return this.client;
    const { url, anonKey } = await this.getConfig();
    if (!url || !anonKey) throw new Error('Supabase não configurado');
    const mod = await import(/* webpackIgnore: true */ this.CDN);
    this.client = mod.createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
    return this.client;
  },

  async connect(code, { onMessage, onStatus }) {
    this._code = code;
    this._onMessage = onMessage;
    this._onStatus = onStatus;
    const client = await this._ensureClient();

    if (this._channel) await client.removeChannel(this._channel);

    // Realtime: entrega imediata de novas linhas desta sessão. Sem polling.
    this._channel = client
      .channel(`session:${code}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sync_events',
        filter: `session_code=eq.${code}`,
      }, (payload) => {
        const row = payload.new;
        if (row && this._onMessage) this._onMessage(this._rowToEnvelope(row));
      })
      .subscribe((status) => {
        if (!this._onStatus) return;
        if (status === 'SUBSCRIBED') this._onStatus('online');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this._onStatus('offline');
      });

    return true;
  },

  _rowToEnvelope(row) {
    return {
      id: row.envelope_id,
      sessionCode: row.session_code,
      deviceId: row.device_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      payload: row.payload,
      createdAt: new Date(row.created_at).getTime(),
    };
  },

  async send(envelope) {
    const client = await this._ensureClient();
    const { error } = await client.from('sync_events').insert({
      envelope_id: envelope.id,
      session_code: envelope.sessionCode,
      device_id: envelope.deviceId,
      entity_type: envelope.entityType,
      entity_id: envelope.entityId,
      operation: envelope.operation,
      payload: envelope.payload,
    });
    // Conflito de chave única = já lá está. Não é erro: o reenvio é idempotente.
    if (error && error.code !== '23505') throw new Error(error.message);
    return true;
  },

  /** Recupera o histórico da sessão (quem entra a meio, ou volta de offline). */
  async fetchSince(code, sinceTs) {
    const client = await this._ensureClient();
    const since = new Date(sinceTs || 0).toISOString();
    const { data, error } = await client
      .from('sync_events')
      .select('*')
      .eq('session_code', code)
      .gt('created_at', since)
      .order('created_at', { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => this._rowToEnvelope(r));
  },

  /**
   * Diagnóstico da ligação. Faz um pedido REST simples (sem a biblioteca, para
   * isolar problemas de carregamento do CDN) e devolve o que correu mal em
   * linguagem clara. Serve para não andarmos a adivinhar.
   */
  async testConnection() {
    const s = await DB.get(DB.STORES.settings, 'app');
    const rawUrl = s?.supabaseUrl || '';
    const url = this.normalizeUrl(rawUrl);
    const key = (s?.supabaseAnonKey || '').trim();
    const out = { url, rawUrl, keyLength: key.length, ok: false, steps: [] };

    if (!url) { out.error = 'URL vazio. Cola o endereço do projeto (https://xxxx.supabase.co).'; return out; }
    if (!key) { out.error = 'Chave anon vazia.'; return out; }
    if (key.length < 100) { out.error = `A chave parece incompleta (${key.length} caracteres; costuma ter mais de 200). Copia-a outra vez — no iPad é fácil cortar.`; return out; }
    if (!/^ey/.test(key) && !/^sb_/.test(key)) { out.error = 'A chave não tem o formato esperado. Confirma que copiaste a chave "anon"/"publishable" e não outra coisa.'; return out; }

    // 0. A chave pertence a ESTE projeto?
    // As chaves antigas (formato JWT) trazem a referência do projeto lá dentro.
    // Comparamos com o subdomínio do URL: é um erro comum ter vários projetos
    // e misturar o URL de um com a chave de outro.
    if (/^ey/.test(key)) {
      try {
        const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const urlRef = new URL(url).hostname.split('.')[0];
        out.steps.push(`Chave: tipo antigo (JWT), papel "${payload.role || '?'}", projeto "${payload.ref || '?'}"`);
        if (payload.ref && urlRef && payload.ref !== urlRef) {
          out.error = `A chave pertence ao projeto "${payload.ref}" mas o URL aponta para "${urlRef}". Copia a chave da página API deste projeto.`;
          return out;
        }
        if (payload.role && payload.role !== 'anon') {
          out.error = `Esta chave tem o papel "${payload.role}". Usa a chave anon/publishable (nunca a service_role).`;
          return out;
        }
      } catch (e) { out.steps.push('Chave: não foi possível ler o conteúdo do JWT'); }
    } else if (/^sb_/.test(key)) {
      out.steps.push('Chave: tipo novo (publishable)');
    }

    // 1. O endereço responde?
    try {
      const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      out.steps.push(`REST: HTTP ${r.status}`);
      if (r.status === 401) {
        out.error = /^ey/.test(key)
          ? 'Chave rejeitada (401). O Supabase mudou as chaves: em projetos novos, a chave antiga (eyJ..., "Legacy API key") pode estar DESATIVADA. Vai a Project Settings → API Keys e usa a "Publishable key" (sb_publishable_...), ou ativa as chaves legacy.'
          : 'Chave rejeitada (401). Confirma que copiaste a Publishable key deste projeto.';
        return out;
      }
      if (r.status === 404) { out.error = 'Endereço inválido (404). Confirma o URL do projeto.'; return out; }
    } catch (e) {
      out.error = `Não foi possível contactar ${url}. Verifica a internet e se o projeto do Supabase não está pausado. (${e.message})`;
      return out;
    }

    // 2. A tabela existe e as políticas deixam ler?
    try {
      const r = await fetch(`${url}/rest/v1/sync_events?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      out.steps.push(`Tabela: HTTP ${r.status}`);
      if (r.status === 404) { out.error = 'A tabela sync_events não existe neste projeto. Corre o SQL de configuração.'; return out; }
      if (!r.ok) { out.error = `Leitura recusada (HTTP ${r.status}). Verifica as políticas RLS. ${(await r.text()).slice(0, 160)}`; return out; }
    } catch (e) {
      out.error = 'Falha ao ler a tabela: ' + e.message;
      return out;
    }

    // 3. Escrita real (é isto que falha quando nada aparece na tabela)
    try {
      const probe = {
        envelope_id: 'diag_' + Date.now(),
        session_code: 'DIAGNO',
        device_id: 'diagnostico',
        entity_type: 'diag',
        operation: 'upsert',
        payload: { teste: true },
      };
      const r = await fetch(`${url}/rest/v1/sync_events`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(probe),
      });
      out.steps.push(`Escrita: HTTP ${r.status}`);
      if (!r.ok) { out.error = `Escrita recusada (HTTP ${r.status}). ${(await r.text()).slice(0, 200)}`; return out; }
    } catch (e) {
      out.error = 'Falha ao escrever: ' + e.message;
      return out;
    }

    // 4. A biblioteca do Supabase carrega? (necessária para o tempo real)
    try {
      await import(/* webpackIgnore: true */ this.CDN);
      out.steps.push('Biblioteca: carregada');
    } catch (e) {
      out.error = 'A ligação REST funciona, mas a biblioteca de tempo real não carregou (o ecrã do banco não vai atualizar sozinho): ' + e.message;
      return out;
    }

    out.ok = true;
    return out;
  },

  async disconnect() {
    if (this.client && this._channel) {
      await this.client.removeChannel(this._channel);
      this._channel = null;
    }
    return true;
  },
};

window.TransportSupabase = TransportSupabase;
