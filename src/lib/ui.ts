import type { ResultQuery } from '../../shared/types';
import { clientJSONCache, type JSONReadOptions } from './client-cache.ts';

export const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pt-BR').format(value);
export const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const searchText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
export const calendarDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
export const time = (value?: string | null) => { if (!value) return '—'; if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return value.match(/\d\d:\d\d(?::\d\d)?/)?.[0] || '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
export const dateTime = (value?: string | null) => { if (!value) return '—'; if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) { const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](.*)$/); return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]} (fuso não declarado)` : value; } const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}); };
export const params = (query: ResultQuery) => new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
export const getJSON=<T>(url:string,signal?:AbortSignal,options?:JSONReadOptions):Promise<T>=>clientJSONCache.read<T>(url,signal,options);
export const peekJSON=<T>(url:string,options?:{allowStale?:boolean;markStale?:boolean}):T|null=>clientJSONCache.peek<T>(url,options);
export const invalidateJSON=(url:string)=>clientJSONCache.invalidate(url);
export const jsonCacheDeadline=(url:string)=>clientJSONCache.deadline(url);
export function readStorage<T>(key: string, fallback: T, validate: (data: unknown) => boolean): T { try { const parsed: unknown = JSON.parse(localStorage.getItem(key) || 'null'); return validate(parsed) ? parsed as T : fallback; } catch { return fallback; } }
export function saveStorage(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Navegadores privados podem indisponibilizar o armazenamento. */ } }
