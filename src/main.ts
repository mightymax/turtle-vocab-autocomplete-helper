import { Store, Parser } from 'n3'
import fs from 'fs'
import { QueryEngine } from '@comunica/query-sparql'
const engine = new QueryEngine();
import prefixes, { shrink} from '@zazuko/prefixes'
import _dedent from 'dedent';
import metadata from './metadata.js';
// @ts-ignore
const dedent = (s: string): string => _dedent(s)

interface VocabIndexItem {
  prefix: string
  iri: string
  label?: string
  description?: string
}

type VocabIndex = Record<string, Omit<VocabIndexItem, 'prefix'>>

interface VocabItem {
  category: string
  label?: string
  description?: string
}

interface Vocab extends VocabIndexItem {
  items: Record<string, VocabItem>
}

const vocabIndex: VocabIndex = {}

const loadStore = (path: fs.PathLike): Store => {
  const store = new Store();
  const parser = new Parser();
  parser.parse(
      fs.readFileSync(path, 'utf-8'),
      (e, q, _) => {
        if (e) throw e
        if (q) store.addQuad(q)
      }
    );
  return store
}

const query = async (data: fs.PathLike, query: string) => await engine.queryBindings(query, { sources: [loadStore(data)] })

const metaQuery = fs.readFileSync('./query.meta.rq', 'utf-8')
const itemQuery = fs.readFileSync('./query.item.rq', 'utf-8')

const count = Object.keys(prefixes).length
let i = 0
for (const prefix in prefixes) {
  const iri = prefixes[prefix]
  i++
  process.stdout.write(`${i}/${count} : ${prefix} => `)
  const metaFile =  `node_modules/@vocabulary/${prefix}/meta.nt`
  vocabIndex[prefix] = { iri }

  // metadata
  if (fs.existsSync(metaFile)) {
    const bindings = await (await query(metaFile, metaQuery)).toArray()
    if (bindings.length) {
      const binding = bindings.pop()!
      vocabIndex[prefix].iri = binding.get('iri')!.value
  
  
      if (binding.has('description')) {
        vocabIndex[prefix].description = dedent(binding.get('description')!.value.replace(/\t/g, ' '))
          .split('\n')
          .map(line => line.trim())
          .join(' ')
      } else if (metadata.get(prefix)?.description !== undefined) {
        vocabIndex[prefix].description = dedent(metadata.get(prefix)!.description!.replace(/\t/g, ' '))
          .split('\n')
          .map(line => line.trim())
          .join(' ')
      }
      if (binding.has('label')) {
        vocabIndex[prefix].label = binding.get('label')!.value
      }  else if (metadata.get(prefix)?.label !== undefined) {
        vocabIndex[prefix].label = metadata.get(prefix)?.label!
      }
    }
  }

  const itemFile =  `node_modules/@vocabulary/${prefix}/${prefix}.nq`
  if (fs.existsSync(itemFile)) {
    const bindings = await (await query(itemFile, itemQuery.replace('$GRAPH', vocabIndex[prefix].iri))).toArray()

    const vocab: Vocab = {
      ... vocabIndex[prefix],
      prefix,
      items: {}
    }
    bindings.forEach(binding => {
      if (!binding.get('item')!.value.startsWith(iri)) return
      const term = shrink(binding.get('item')!.value).replace(`${prefix}:`, '')
      if (term === '') return
      vocab.items[term] = {
        category: binding.get('category')!.value
      }
      if (binding.has('description')) {
        vocab.items[term].description = dedent(binding.get('description')!.value.replace(/\t/g, ' '))
          .split('\n')
          .map(line => line.trim())
          .join(' ')
      }
      if (binding.has('label')) {
        vocab.items[term].label = binding.get('label')!.value
      }
    })
    fs.writeFileSync(`Vocabularies/${prefix}.json`, JSON.stringify(vocab, null, 2))
  }
  process.stdout.write(`✔ \n`)
}

fs.writeFileSync(`Vocabularies/vocabularies.json`, JSON.stringify(vocabIndex, null, 2))
