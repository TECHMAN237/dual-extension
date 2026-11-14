# Fiche de grammaire du douala (duálá, ISO 639-3 `dua`)

Synthèse rédigée pour DOUALA AI à partir de sources ouvertes, consultées le 2026-11-14. Chaque règle cite sa source ; les exemples sont repris tels qu'ils figurent dans la source (orthographe comprise). « Non documenté » signifie que les sources ouvertes consultées ne disent rien de fiable sur le point : rien n'a été déduit ni deviné. Tout reste à valider par un locuteur.

Sources :
- **WP-fr** : Wikipédia (fr), « Duala (langue) », révision 241045385, CC BY-SA 4.0 — https://fr.wikipedia.org/wiki/Duala_(langue). L'article cite lui-même Nseme (1998), Helmlinger (1972) et duala.douala.free.fr.
- **WP-en** : Wikipedia (en), « Duala language », révision 1359233633, CC BY-SA 4.0 — https://en.wikipedia.org/wiki/Duala_language
- **WALS** : Dryer & Haspelmath (éd.), *WALS Online*, langue Duala (`dua`), CC BY 4.0 — https://wals.info/languoid/lect/wals_code_dua. Chaque valeur y cite une grammaire publiée (Ittmann 1939, 1978 ; Meinhof 1912 ; Biloa 1993).
- **Wiktionnaire / Wiktionary** : pages des mots cités, CC BY-SA 4.0.
- **Mboa Sawa** : pages du dictionnaire citées (aucune licence déclarée, voir `docs/LINGUISTIC_RESEARCH.md`).

Format de chaque règle (lu par `pnpm ingest:grammar`) : un titre `### Gnn · titre`, un paragraphe, puis des lignes `- Exemple :` et `- Source :`.

## Écriture et sons

### G01 · Orthographes : Meinhof et AGLC

Le douala a connu plusieurs orthographes. Celle de Meinhof (1901, Mission de Bâle) note certaines voyelles avec un trait souscrit (e̱, o̱) ; l'Alphabet général des langues camerounaises (AGLC, 1978) utilise ɓ, ɗ, ɛ, ɔ, ŋ et note les tons. Les dictionnaires importés mélangent les deux : il faut garder l'orthographe de la référence utilisée et ne pas mélanger les deux systèmes dans une même phrase. Mboa Sawa écrit souvent ę et q là où l'AGLC a ɛ et ɔ (probable substitution de police) : ces formes sont conservées telles quelles.

- Exemple : « bɛ » (AGLC) et « be̱ » (Meinhof) pour « être »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://fr.wiktionary.org/wiki/b%C9%9B

### G02 · Les tons sont écrits sur les voyelles

Le douala est une langue à tons. En AGLC, l'accent aigu note le ton haut (á), le macron le ton moyen (ā), la voyelle sans signe le ton bas (a), l'accent antiflexe le ton montant (ǎ) et l'accent circonflexe le ton descendant (â). Les accents font partie du mot : il faut les recopier exactement.

- Exemple : « madíɓá » = « eau »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://en.wikipedia.org/wiki/Duala_language

### G03 · ɓ et ɗ

En AGLC, ɓ et ɗ notent les réalisations implosives de /b/ et /d/ devant toutes les voyelles sauf i et u. Un même mot peut donc apparaître avec b ou ɓ selon l'orthographe de la source.

- Exemple : « ɗá » = « manger »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

## Le nom

### G04 · Classes nominales par paires singulier / pluriel

Les noms se répartissent en classes, regroupées par paires singulier/pluriel : 1/2, 3/4, 5/6, 7/8, 19/12, 14/4 et 9/10. La classe d'un nom se voit surtout à son préfixe et commande les accords.

- Exemple : « muléma » / « miléma » = « le cœur » / « les cœurs » (paire 3/4)
- Exemple : « dísɔ » / « mísɔ » = « l'œil » / « les yeux »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G05 · Préfixes nominaux des classes

Préfixes des noms, devant consonne puis devant voyelle (tableau de l'article, d'après Nseme 1998, p. 129, et Helmlinger 1972, p. xii) : classe 1 mo-, mu- / mw-, m- ; 2 ba- / b- ; 3 mu- / mw-, m ; 4 mi- / my- ; 5 di- / d-, j- ; 6 ma- / m- ; 7 e- / ey-, y- ; 8 be- / by-, b- ; 9 et 10 n- (nasale) / ɲ- ; 14 bo- / bw-, b- ; 12 lo- / l- ; 19 i- / y-.

- Exemple : « moto » = « homme, personne » (classe 1)
- Exemple : « soŋgá » / « masoŋgá » = « la dent » / « les dents »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G06 · Accord avec le nom

Adjectifs, démonstratifs, possessifs et verbes prennent un préfixe d'accord qui dépend de la classe du nom. Le tableau des préfixes adjectivaux et verbaux donne par exemple : classe 1 nú- (adjectif) et a- (verbe) ; classe 2 bá- ; classe 3 mú- ; classe 4 mí- ; classe 5 di- ; classe 6 má- ; classe 7 é- ; classe 8 bé- ; classe 14 bó- ; classe 12 ló-. Certains adjectifs sont donnés comme radicaux sans préfixe (« -ndɛ̄nɛ » grand, « -sadi » petit), qui prennent le préfixe de la classe du nom. L'exemple du Wiktionnaire ci-dessous montre un nom de la classe 14 (bolongi) avec un démonstratif en bó- et un mot en bo-, à confirmer par un locuteur.

- Exemple : « Bón bolongi bo kolo » = « Ce bâtiment est grand »
- Exemple : « éndɛ̄nɛ », « ɓondɛ́nɛ » = « grand » (formes avec préfixe)
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://fr.wiktionary.org/wiki/b%C3%B3n

### G07 · Article

Non documenté. Les sources ouvertes consultées ne décrivent pas d'article défini ou indéfini ; les dictionnaires traduisent « la maison » et « maison » par le même mot. En traduction, ne pas inventer d'équivalent aux articles français ou anglais.

- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

## Pronoms et déterminants

### G08 · Pronoms personnels

Pronoms personnels (tableau de l'article, d'après Nseme 1998, p. 128) : 1re personne mbá (sg.), bisɔ́ (pl.) ; 2e personne oá, binyɔ́ ; 3e personne mɔ́, babɔ́. Mboa Sawa écrit « mɓá » (je, moi), « ɓisɔ́ » (nous), « ɓińó » (vous) : même mot, autre orthographe.

- Exemple : « bolá mbá madíbá » = « donne-moi de l'eau »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://mboasawa.com/fr/dictionnaire-duala/m%c9%93a/

### G09 · Marques de sujet sur le verbe

Le verbe porte un préfixe de personne (tableau de l'article, d'après Nseme 1998, p. 128) : 1re sg. n-, 2e sg. w-, 3e sg. a- (ou le préfixe de la classe du sujet), 1re pl. j-, 2e pl. l, 3e pl. ba- (ou préfixe de classe). Dans les phrases du même article, la 1re personne apparaît sous la forme « na » devant le verbe.

- Exemple : « na púlá dá » = « je veux manger »
- Exemple : « na bi » = « je sais »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G10 · Possessifs : après le nom, accordés avec lui

Le possessif se place après le nom possédé. Mboa Sawa donne des possessifs adjectifs (ám 1re sg., áó 3e sg., áu ou áṣu 1re pl., ábu ou ɓáɓu 3e pl.) et des formes qui varient selon la classe du nom possédé (par exemple mọŋgọ, 2e sg. ; yam, yao, yasu, yańu, yabu ou ńáo, ńáńu, ńábu selon le « genre » du nom). Le Wiktionnaire donne « bó̱ngo̱ » (ton, ta, tes), placé après le nom dans ses exemples.

- Exemple : « bolóngi bó̱ngo̱ » = « ta maison »
- Exemple : « bwele bó̱ngo̱ » = « ton arbre »
- Source : https://fr.wiktionary.org/wiki/b%C3%B3%CC%B1ngo%CC%B1
- Source : https://mboasawa.com/fr/dictionnaire-duala/am/
- Source : https://mboasawa.com/fr/dictionnaire-duala/mongo-2/

### G11 · Démonstratifs : avant le nom, trois distances

Le démonstratif précède le nom (WALS 88A, d'après Ittmann 1978, p. 81 et 241). Il s'accorde avec la classe du nom et a trois degrés : proche, moyen, lointain. Par exemple, pour les classes 1/2 : nú / bá (proche), nún / bán (moyen), núnɛ / bánɛ (lointain) ; pour la classe 14 : bó, bón, bónɛ.

- Exemple : « Bón bolongi bo kolo » = « Ce bâtiment est grand »
- Source : https://wals.info/feature/88A
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

## Le verbe

### G12 · Présent

Mboa Sawa donne « ma- » comme « préfixe du présent ». L'article Wikipédia contient la phrase « na sí ma púlá dá » (je ne veux pas manger), où ma figure devant le verbe ; les sources ne détaillent pas davantage son emploi.

- Exemple : « na sí ma púlá dá » = « je ne veux pas manger »
- Source : https://mboasawa.com/fr/dictionnaire-duala/ma/
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G13 · Futur

D'après Mboa Sawa, la forme du présent mɛnɗɛ (d'un verbe « aller ») est employée en douala comme auxiliaire du futur (entrée « enɗɛ »). La construction exacte (place de l'auxiliaire, forme du verbe principal) n'est pas documentée dans les sources ouvertes.

- Source : https://mboasawa.com/fr/dictionnaire-duala/en%c9%97%c9%9b-2/
- Source : https://mboasawa.com/fr/dictionnaire-duala/mende-2/

### G14 · Passé et autres aspects

Non documenté. Les sources ouvertes consultées ne décrivent pas les marques du passé ni de l'aspect (« kwań », le passé, est un nom). Ne pas inventer de marque de temps : garder la forme du verbe donnée par le dictionnaire.

- Source : https://mboasawa.com/fr/dictionnaire-duala/kwan/

### G15 · Infinitif et forme de citation

Non documenté en détail. Les dictionnaires donnent les verbes sous une forme de citation (« ɗá » manger, « nyɔ́ » boire, « anda » acheter) qui sert de traduction des infinitifs français.

- Exemple : « ɗá » = « manger »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G16 · Dérivation verbale

Mboa Sawa décrit des formes dérivées des verbes : causatif (« f. caus. »), réfléchi (« f. réfl. »), réciproque (« f. récipr. »), applicatif (« f. appl. »), instrumental, passif. Ces formes sont des mots du dictionnaire à part entière ; il ne faut pas les fabriquer soi-même.

- Exemple : « úańęlę » = « s'interroger l'un l'autre » (réciproque de úęlę)
- Source : https://mboasawa.com/fr/dictionnaire-duala/uanele/

## La phrase

### G17 · Ordre des mots : sujet, verbe, objet

L'ordre de base est sujet – verbe – objet (WALS 81A, 82A, 83A, d'après Ittmann 1978, p. 240 ; aussi Wikipedia en).

- Exemple : « na púlá ñó madíbá » = « je veux boire de l'eau »
- Source : https://wals.info/feature/81A
- Source : https://en.wikipedia.org/wiki/Duala_language

### G18 · Ordre dans le groupe nominal

Le nom précède l'adjectif (WALS 87A) et le complément du nom (« génitif », WALS 86A), d'après Ittmann 1978, p. 240. Le démonstratif, lui, précède le nom (G11).

- Exemple : « ndábo a mukála » = « une maison en dur »
- Source : https://wals.info/feature/87A
- Source : https://wals.info/feature/86A
- Source : https://fr.wiktionary.org/wiki/nd%C3%A1bo_a_muk%C3%A1la

### G19 · Négation : particule avant le verbe

La négation est une particule placée juste avant le verbe, après le sujet : sujet – négation – verbe – objet (WALS 112A, 143A, 144A, d'après Ittmann 1978, p. 151). Dans les phrases de l'article Wikipédia, cette particule est « sí ». Mboa Sawa donne « sétọ » pour la négation d'un nom ou d'un infinitif (« pas »).

- Exemple : « na bi » = « je sais » ; « na sí bí » = « je ne sais pas »
- Exemple : « na sí ma púlá dá » = « je ne veux pas manger »
- Source : https://wals.info/feature/143A
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://mboasawa.com/fr/dictionnaire-duala/seto/

### G20 · Questions

Mots interrogatifs (Mboa Sawa) : « ɓéna » qui, « nję » que / quoi, « wẹ́ » où, « nęni » comment, « ɓéniŋga » combien, « óńolanje » pourquoi ; « nga » introduit une interrogation directe. La place du mot interrogatif dans la phrase et l'intonation ne sont pas documentées.

- Source : https://mboasawa.com/fr/dictionnaire-duala/we-3/
- Source : https://mboasawa.com/fr/dictionnaire-duala/nje/
- Source : https://mboasawa.com/fr/dictionnaire-duala/nga/

### G21 · Verbe « donner » : deux objets

Avec « donner », le bénéficiaire et la chose donnée suivent tous deux le verbe sans préposition (construction à double objet, WALS 105A, d'après Biloa 1993, p. 69).

- Exemple : « bolá mbá madíbá » = « donne-moi de l'eau »
- Source : https://wals.info/feature/105A
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G22 · « Et » entre deux noms = « avec »

Le mot qui relie deux noms (« et ») est le même que « avec » (WALS 63A, d'après Ittmann 1939).

- Source : https://wals.info/feature/63A

### G23 · Être, avoir, comparer

D'après WALS (Ittmann 1939) : la phrase nominale peut se passer de verbe « être » (copule zéro possible, 120A) ; « être quelque chose » et « être quelque part » se construisent de la même façon (119A) ; la possession (« avoir ») se dit avec une construction de type « être avec » (117A) ; le comparatif se construit avec un verbe « dépasser » (121A). Les sources ouvertes ne donnent pas d'exemple douala de ces constructions.

- Source : https://wals.info/feature/120A
- Source : https://wals.info/feature/117A
- Source : https://wals.info/feature/121A

## Nombres

### G24 · Nombres de un à dix

ewɔ̄ (1), béɓǎ (2), bélálo (3), bénɛí (4), bétánu (5), mutōɓā (6), sǎmbā (7), lɔmbi (8), dibuā (9), ɗôm (10). Pour 1 à 5, l'article donne aussi des formes qui s'accordent avec la classe du nom (par ex. miɓa, maɓa, baɓa, iɓa pour « deux »).

- Exemple : « bétánu » = « cinq »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)

### G25 · Ordinaux

« Premier » est un mot à part ; les autres ordinaux sont formés sur les nombres (« deux-ième », « trois-ième »), d'après WALS 53A (Meinhof 1912). Les formes douala ne sont pas documentées dans les sources ouvertes.

- Source : https://wals.info/feature/53A

## Politesse

### G26 · Formules de politesse

« son » ou « són ! » = « s'il te plaît ». Salutations : « etám ! » (adressée à une assemblée), « ekwamwáto » (ouverture pour une assemblée), « njétúśę » (salutation douala ; réponse « Ńamɓé »). Les équivalents de « bonjour », « merci », « au revoir » ne figurent pas dans les sources ouvertes importées : non documenté.

- Exemple : « son » = « s'il te plaît »
- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
- Source : https://mboasawa.com/fr/dictionnaire-duala/son-2/
- Source : https://mboasawa.com/fr/dictionnaire-duala/njetuse/
- Source : https://mboasawa.com/fr/dictionnaire-duala/etam-2/

### G27 · Oui et non

« Ee » = oui ; « kɛ́m » = non.

- Source : https://fr.wikipedia.org/wiki/Duala_(langue)
