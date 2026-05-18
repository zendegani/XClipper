# tweet2md Store Description Translations

## English

tweet2md is an open-source Chrome extension that turns x.com content into production-ready Markdown for research, note-taking, AI workflows, and offline archiving. 

What's new?

See the latest updates and releases:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

Key features:

- Three ways to trigger: toolbar popup, inline download button on every tweet's action bar, or right-click context menu (Save / Copy as Markdown / Add to Obsidian)
- Copy Markdown to clipboard, download as a file, or hand off to Obsidian
- One-click Add to Obsidian button — opens Obsidian via the obsidian:// URI scheme with the rendered Markdown prefilled; optional vault name to target a specific vault
- Optional vault subfolder for the Obsidian handoff so notes land inside a specific folder (e.g. Tweets or Inbox/Tweets) — leave blank to use the vault root
- Obsidian-friendly frontmatter (opt-in): wikilinked [[@handle]] author for instant backlinks, synthesized title, published/created date split, prose description snippet, and a tags array — plus all the existing engagement metadata for Dataview queries
- Capture link cards from tweets: title, source domain, and the Open Graph preview image
- Full support for long-form X Articles (formerly Notes) with headings, lists, and code blocks
- Extract tweets, nested threads, and quote tweets into clean Markdown
- Preserve quoted-post structure and context — including the original author's name and handle
- Multi-view popup: primary actions stay focused up front, set-once preferences live in a Settings panel behind a gear icon
- Show or hide the inline button via a toggle if it conflicts with another extension's icon
- Inline button can be configured to copy to clipboard instead of download
- Optional auto-close of new tabs opened via the inline button or context menu after export
- Download embedded X media locally alongside your md file to prevent link rot
- Optional Downloads subfolder so Markdown files and images land inside a chosen subfolder of your Downloads folder, instead of cluttering the root
- Rich YAML frontmatter with author, handle, date, source URL, content type, and engagement stats (likes, reposts, replies, bookmarks, views)
- Optional X-style engagement row directly in the Markdown body (likes, reposts, replies, bookmarks, views) — toggle independently of the YAML frontmatter
- Automatically expand truncated posts and strip engagement buttons, follow prompts, and trackers
- Multi-language UI: English, Spanish, German, French, Japanese, Portuguese (Brazil), Chinese (Simplified), Arabic, and Persian. Content extraction works on any language regardless of UI translation
- Light and dark mode popup, matching your system preferences

Great for:

- Importing X content into Obsidian, Notion, Logseq, Hugo, or any Markdown-based PKM system
- Exporting clean text for LLM prompts, RAG pipelines, or AI training workflows
- Archiving research threads, news references, and long-form articles offline
- Building a searchable Second Brain from your Twitter/X activity
- Preparing source material for writing, translation, or summarization

Why use it:

- One-click workflow from any tweet, thread, or article page — popup, inline icon, or right-click menu
- First-class Obsidian path: hit Add to Obsidian and the note lands in your vault, no plugin or sync setup required
- Clean, well-structured Markdown output that is easy to edit and index
- Local image archiving so your saved content never has broken links
- Zero-API architecture — works directly in your browser with no API keys or accounts
- Processes everything locally on your device. No analytics, no tracking, no data leaves your machine.

Current limitations:

- Focused on x.com content extraction
- Videos and GIFs are not exported as playable media files
- Requires a page reload if the extension was installed or updated after opening the tab. This is intentional to avoid silent failures and ensure content is extracted reliably from a properly initialized page.
- Some content may stop working if x.com changes its page structure significantly

This is an open-source project.
tweet2md is an independent tool and is not affiliated with X or x.com. 


## Spanish (es)

```text
tweet2md es una extensión de Chrome de código abierto que convierte contenido de x.com en Markdown listo para producción para investigación, toma de notas, flujos de trabajo de IA y archivado offline.

¿Qué hay de nuevo?

Consulta las últimas actualizaciones y lanzamientos:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

Características principales:

- Tres formas de activación: popup de la barra de herramientas, botón inline en la barra de acciones de cada tweet o menú contextual con clic derecho (Guardar / Copiar como Markdown / Añadir a Obsidian)
- Copia Markdown al portapapeles, descárgalo como archivo o envíalo a Obsidian
- Botón "Añadir a Obsidian" con un clic: abre Obsidian mediante el esquema obsidian:// con el Markdown renderizado ya rellenado; nombre de vault opcional para apuntar a un vault específico
- Subcarpeta opcional del vault para la integración con Obsidian: crea las notas dentro de una carpeta específica (ej. Tweets o Inbox/Tweets) — déjala vacía para usar la raíz del vault
- Frontmatter compatible con Obsidian (opcional): autor [[@handle]] con wikilinks para backlinks instantáneos, título generado, separación entre fecha de publicación y creación, fragmento descriptivo y array de etiquetas, además de todos los metadatos de interacción existentes para consultas Dataview
- Captura tarjetas de enlaces de tweets: título, dominio de origen e imagen Open Graph
- Compatibilidad completa con artículos largos de X (antes Notes), incluyendo encabezados, listas y bloques de código
- Extrae tweets, hilos anidados y tweets citados en Markdown limpio
- Conserva la estructura y el contexto de publicaciones citadas, incluyendo el nombre y handle del autor original
- Popup de múltiples vistas: las acciones principales permanecen visibles y las preferencias se encuentran en un panel de Configuración detrás de un icono de engranaje
- Muestra u oculta el botón inline mediante un interruptor si entra en conflicto con otra extensión
- El botón inline puede configurarse para copiar al portapapeles en lugar de descargar
- Cierre automático opcional de pestañas nuevas abiertas mediante el botón inline o menú contextual después de exportar
- Descarga medios incrustados de X localmente junto al archivo md para evitar enlaces rotos
- Subcarpeta opcional de Descargas: los archivos Markdown y las imágenes se guardan en una subcarpeta elegida en lugar de mezclarse con el resto de Descargas
- YAML frontmatter enriquecido con autor, handle, fecha, URL fuente, tipo de contenido y estadísticas de interacción (likes, reposts, respuestas, marcadores, vistas)
- Fila opcional de interacciones estilo X directamente en el cuerpo Markdown (likes, reposts, respuestas, marcadores, vistas), configurable independientemente del YAML frontmatter
- Expande automáticamente publicaciones truncadas y elimina botones de interacción, sugerencias de seguimiento y rastreadores
- Interfaz multilingüe: inglés, español, alemán, francés, japonés, portugués (Brasil), chino simplificado, árabe y persa. La extracción de contenido funciona en cualquier idioma independientemente de la traducción de la interfaz
- Popup en modo claro y oscuro, adaptado a las preferencias del sistema

Ideal para:

- Importar contenido de X en Obsidian, Notion, Logseq, Hugo o cualquier sistema PKM basado en Markdown
- Exportar texto limpio para prompts LLM, pipelines RAG o flujos de trabajo de entrenamiento de IA
- Archivar offline hilos de investigación, referencias de noticias y artículos largos
- Construir un Second Brain buscable a partir de tu actividad en Twitter/X
- Preparar material fuente para escritura, traducción o resúmenes

Por qué usarlo:

- Flujo de trabajo de un clic desde cualquier tweet, hilo o artículo mediante popup, icono inline o menú contextual
- Integración de primera clase con Obsidian: pulsa "Añadir a Obsidian" y la nota aparece en tu vault sin plugins ni sincronización
- Salida Markdown limpia y bien estructurada, fácil de editar e indexar
- Archivado local de imágenes para evitar enlaces rotos
- Arquitectura sin API: funciona directamente en el navegador sin claves API ni cuentas
- Todo se procesa localmente en tu dispositivo. Sin analíticas, sin seguimiento y sin transmisión de datos.

Limitaciones actuales:

- Enfocado en la extracción de contenido de x.com
- Los videos y GIFs no se exportan como archivos multimedia reproducibles
- Requiere recargar la página si la extensión fue instalada o actualizada después de abrir la pestaña. Esto evita fallos silenciosos y garantiza una extracción fiable.
- Parte del contenido puede dejar de funcionar si x.com cambia significativamente su estructura

Este es un proyecto de código abierto.
tweet2md es una herramienta independiente y no está afiliada a X ni x.com.
```

## German (de)

```text
tweet2md ist eine Open-Source-Chrome-Erweiterung, die Inhalte von x.com in produktionsreifes Markdown für Recherche, Notizen, KI-Workflows und Offline-Archivierung umwandelt.

Was ist neu?

Die neuesten Updates und Releases:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

Hauptfunktionen:

- Drei Möglichkeiten zum Auslösen: Toolbar-Popup, Inline-Download-Button bei jedem Tweet oder Rechtsklick-Kontextmenü (Als Markdown speichern / kopieren / Zu Obsidian hinzufügen)
- Markdown in die Zwischenablage kopieren, als Datei herunterladen oder an Obsidian übergeben
- Ein-Klick-Button „Zu Obsidian hinzufügen”: öffnet Obsidian über das obsidian://-URI-Schema mit vorausgefülltem Markdown; optionaler Vault-Name
- Optionaler Vault-Unterordner für die Obsidian-Übergabe: Notizen werden in einem bestimmten Ordner abgelegt (z. B. Tweets oder Inbox/Tweets) — leer lassen für das Vault-Stammverzeichnis
- Obsidian-freundliches Frontmatter (optional): wikiverlinkter [[@handle]]-Autor, generierter Titel, getrennte Veröffentlichungs- und Erstellungsdaten, Beschreibungsauszug und Tags-Array sowie bestehende Engagement-Metadaten für Dataview-Abfragen
- Erfasst Linkkarten aus Tweets: Titel, Quelldomain und Open-Graph-Vorschaubild
- Vollständige Unterstützung für lange X-Artikel (ehemals Notes) mit Überschriften, Listen und Codeblöcken
- Extrahiert Tweets, verschachtelte Threads und zitierte Tweets in sauberes Markdown
- Bewahrt Struktur und Kontext zitierter Beiträge einschließlich Name und Handle des ursprünglichen Autors
- Mehransichts-Popup mit fokussierten Hauptaktionen und Einstellungen hinter einem Zahnrad-Symbol
- Inline-Button kann bei Konflikten mit anderen Erweiterungen ein- oder ausgeblendet werden
- Inline-Button kann so konfiguriert werden, dass Markdown kopiert statt heruntergeladen wird
- Optionales automatisches Schließen neuer Tabs nach dem Export
- Lädt eingebettete X-Medien lokal zusammen mit der md-Datei herunter, um Linkverlust zu vermeiden
- Optionaler Downloads-Unterordner: Markdown-Dateien und Bilder landen in einem ausgewählten Unterordner statt direkt im Downloads-Verzeichnis
- Umfangreiches YAML-Frontmatter mit Autor, Handle, Datum, Quell-URL, Inhaltstyp und Engagement-Statistiken
- Optionale X-ähnliche Engagement-Zeile direkt im Markdown-Text
- Erweitert automatisch gekürzte Beiträge und entfernt Engagement-Buttons, Follow-Hinweise und Tracker
- Mehrsprachige Oberfläche: Englisch, Spanisch, Deutsch, Französisch, Japanisch, Portugiesisch (Brasilien), vereinfachtes Chinesisch, Arabisch und Persisch
- Hell- und Dunkelmodus passend zu den Systemeinstellungen

Ideal für:

- Importieren von X-Inhalten in Obsidian, Notion, Logseq, Hugo oder andere Markdown-basierte PKM-Systeme
- Export sauberer Texte für LLM-Prompts, RAG-Pipelines oder KI-Trainingsworkflows
- Offline-Archivierung von Recherche-Threads, Nachrichtenreferenzen und langen Artikeln
- Aufbau eines durchsuchbaren Second Brain aus Twitter/X-Aktivitäten
- Vorbereitung von Quellenmaterial für Schreiben, Übersetzung oder Zusammenfassungen

Warum verwenden?

- Ein-Klick-Workflow für Tweets, Threads und Artikel
- Erstklassige Obsidian-Integration ohne Plugins oder Synchronisation
- Saubere, gut strukturierte Markdown-Ausgabe
- Lokale Bildarchivierung gegen defekte Links
- Keine API erforderlich — funktioniert direkt im Browser
- Alles wird lokal verarbeitet. Keine Analysen, kein Tracking, keine Datenübertragung.

Aktuelle Einschränkungen:

- Fokus auf die Extraktion von x.com-Inhalten
- Videos und GIFs werden nicht als abspielbare Mediendateien exportiert
- Nach Installation oder Update der Erweiterung ist ein Neuladen der Seite erforderlich
- Einige Inhalte funktionieren möglicherweise nicht mehr, wenn x.com seine Seitenstruktur stark verändert

Dies ist ein Open-Source-Projekt.
tweet2md ist ein unabhängiges Tool und nicht mit X oder x.com verbunden.
```

## Japanese (ja)

```text
tweet2md は、x.com のコンテンツを研究、ノート作成、AI ワークフロー、オフラインアーカイブ向けの実用的な Markdown に変換するオープンソースの Chrome 拡張機能です。

新機能

最新の更新とリリース:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

主な機能:

- 3つの起動方法: ツールバーのポップアップ、各ツイートのアクションバー上のインラインボタン、右クリックコンテキストメニュー
- Markdown をクリップボードへコピー、ファイルとしてダウンロード、または Obsidian へ送信
- ワンクリックで Obsidian に追加: obsidian:// URI スキーム経由で Markdown を入力済みの状態で Obsidian を開く
- Obsidian 用 Vault サブフォルダ（任意）: 指定したフォルダ（例: Tweets や Inbox/Tweets）にノートを保存。空欄で Vault のルートに作成
- Obsidian 向け frontmatter（オプション）
- ツイート内リンクカードの取得
- 長文 X Articles（旧 Notes）を完全サポート
- ツイート、スレッド、引用ツイートを Markdown に変換
- 引用投稿の構造とコンテキストを保持
- マルチビュー対応ポップアップ
- インラインボタンの表示・非表示切替
- インラインボタンをコピー動作に変更可能
- エクスポート後に新規タブを自動クローズ可能
- 埋め込み画像やメディアをローカル保存
- ダウンロード用サブフォルダ（任意）: Markdown ファイルや画像をダウンロードフォルダ内の指定サブフォルダに保存
- YAML frontmatter に各種メタデータを追加
- Markdown 本文に X 風のエンゲージメント行を追加可能
- 切り詰められた投稿を自動展開
- 多言語 UI 対応
- システム設定に合わせたライト / ダークモード

活用例:

- Obsidian、Notion、Logseq、Hugo などへのインポート
- LLM プロンプトや RAG パイプライン向けのテキスト出力
- リサーチスレッドや記事のオフライン保存
- Twitter/X 活動から Second Brain を構築
- 執筆、翻訳、要約のための素材準備

選ばれる理由:

- あらゆるツイートや記事からワンクリックで利用可能
- Obsidian との強力な連携
- 編集しやすい整理された Markdown 出力
- ローカル画像保存でリンク切れ防止
- API 不要
- すべてローカル処理。追跡やデータ送信なし。

現在の制限:

- x.com コンテンツ抽出に特化
- 動画や GIF は再生可能なメディアとしては保存されない
- 拡張機能の更新後はページ再読み込みが必要
- x.com の構造変更によって動作しなくなる場合あり

これはオープンソースプロジェクトです。
tweet2md は独立したツールであり、X や x.com とは関係ありません。
```

## French (fr)

```text
tweet2md est une extension Chrome open source qui transforme le contenu de x.com en Markdown prêt pour la production, destiné à la recherche, la prise de notes, les workflows IA et l’archivage hors ligne.

Quoi de neuf ?

Consultez les dernières mises à jour et versions :
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

Fonctionnalités principales :

- Trois méthodes de déclenchement : popup de barre d’outils, bouton inline sur chaque tweet ou menu contextuel clic droit
- Copier le Markdown dans le presse-papiers, télécharger un fichier ou envoyer vers Obsidian
- Bouton « Ajouter à Obsidian » en un clic
- Sous-dossier de vault optionnel pour la liaison Obsidian : les notes sont créées dans un dossier spécifique (ex. Tweets ou Inbox/Tweets) — laissez vide pour utiliser la racine du vault
- Frontmatter compatible Obsidian
- Capture des cartes de liens de tweets
- Support complet des longs articles X
- Extraction des tweets, fils et citations en Markdown propre
- Préservation de la structure et du contexte des citations
- Popup multi-vues avec panneau de paramètres
- Affichage/masquage du bouton inline
- Le bouton inline peut copier au lieu de télécharger
- Fermeture automatique optionnelle des onglets après export
- Téléchargement local des médias intégrés
- Sous-dossier de téléchargements optionnel : les fichiers Markdown et images sont enregistrés dans un sous-dossier choisi au lieu d'encombrer la racine
- YAML frontmatter enrichi avec métadonnées et statistiques
- Ligne d’engagement optionnelle dans le corps Markdown
- Expansion automatique des publications tronquées
- Interface multilingue
- Mode clair et sombre

Idéal pour :

- Importer du contenu X dans Obsidian, Notion, Logseq ou Hugo
- Exporter du texte pour les workflows IA
- Archiver des fils de recherche et articles hors ligne
- Construire un Second Brain consultable
- Préparer des sources pour l’écriture ou la traduction

Pourquoi l’utiliser :

- Workflow en un clic
- Intégration Obsidian sans plugin
- Markdown propre et structuré
- Archivage local des images
- Architecture sans API
- Traitement 100 % local

Limitations actuelles :

- Concentré sur l’extraction du contenu x.com
- Les vidéos et GIF ne sont pas exportés comme médias lisibles
- Un rechargement de page peut être nécessaire après installation ou mise à jour
- Certains contenus peuvent cesser de fonctionner si x.com modifie fortement sa structure

Ceci est un projet open source.
tweet2md est un outil indépendant et n’est pas affilié à X ou x.com.
```

## Portuguese (Brazil) (pt_BR)

```text
tweet2md é uma extensão Chrome de código aberto que transforma conteúdo do x.com em Markdown pronto para produção para pesquisa, anotações, fluxos de trabalho de IA e arquivamento offline.

Novidades

Veja as últimas atualizações e versões:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

Principais recursos:

- Três formas de ativação: popup da barra de ferramentas, botão inline em tweets ou menu de contexto
- Copiar Markdown, baixar arquivo ou enviar para Obsidian
- Botão “Adicionar ao Obsidian” com um clique
- Subpasta opcional de vault para a integração com Obsidian: notas criadas em uma pasta específica (ex.: Tweets ou Inbox/Tweets) — deixe em branco para usar a raiz do vault
- Frontmatter amigável ao Obsidian
- Captura cartões de links de tweets
- Suporte completo para artigos longos do X
- Extrai tweets, threads e citações em Markdown limpo
- Preserva estrutura e contexto das citações
- Popup com múltiplas visualizações
- Mostrar ou ocultar botão inline
- Botão inline pode copiar em vez de baixar
- Fechamento automático opcional de abas após exportação
- Download local de imagens e mídias incorporadas
- Subpasta opcional de Downloads: arquivos Markdown e imagens são salvos em uma subpasta escolhida em vez da raiz
- YAML frontmatter rico com metadados e estatísticas
- Linha opcional de engajamento estilo X
- Expansão automática de posts truncados
- Interface multilíngue
- Tema claro e escuro

Ótimo para:

- Importar conteúdo do X para Obsidian, Notion, Logseq ou Hugo
- Exportar texto para prompts LLM e pipelines RAG
- Arquivar threads de pesquisa offline
- Construir um Second Brain pesquisável
- Preparar material para escrita ou tradução

Por que usar:

- Fluxo de trabalho com um clique
- Integração direta com Obsidian
- Markdown limpo e estruturado
- Arquivamento local de imagens
- Sem necessidade de API
- Tudo processado localmente

Limitações atuais:

- Focado na extração de conteúdo do x.com
- Vídeos e GIFs não são exportados como mídia reproduzível
- Pode ser necessário recarregar a página após instalar ou atualizar a extensão
- Algumas funcionalidades podem parar de funcionar se o x.com mudar sua estrutura

Este é um projeto de código aberto.
tweet2md é uma ferramenta independente e não é afiliada ao X ou x.com.
```

## Chinese Simplified (zh_CN)

```text
tweet2md 是一个开源 Chrome 扩展，可将 x.com 内容转换为适用于研究、笔记记录、AI 工作流和离线归档的高质量 Markdown。

最新更新

查看最新版本与更新：
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

主要功能：

- 三种触发方式：工具栏弹窗、推文内联按钮、右键菜单
- 复制 Markdown、下载文件或发送到 Obsidian
- 一键添加到 Obsidian
- 可选的 Obsidian vault 子文件夹：笔记保存到指定文件夹（如 Tweets 或 Inbox/Tweets），留空则使用 vault 根目录
- 面向 Obsidian 的 frontmatter
- 捕获推文链接卡片
- 完整支持长篇 X Articles
- 提取推文、线程和引用推文
- 保留引用内容结构与上下文
- 多视图弹窗界面
- 可显示或隐藏内联按钮
- 内联按钮可改为复制模式
- 导出后自动关闭标签页
- 本地下载图片与媒体
- 可选的下载子文件夹：Markdown 文件与图片保存到所选子文件夹中，不再直接堆放在下载根目录
- 丰富的 YAML frontmatter 元数据
- 可选 X 风格互动统计行
- 自动展开被截断内容
- 多语言界面
- 支持深色与浅色模式

适用于：

- 导入内容到 Obsidian、Notion、Logseq 或 Hugo
- 导出文本用于 LLM 与 RAG 工作流
- 离线归档研究线程与文章
- 构建可搜索的 Second Brain
- 为写作、翻译与总结准备素材

为什么使用它：

- 一键工作流
- 强大的 Obsidian 集成
- 干净、结构化的 Markdown 输出
- 本地图片归档避免链接失效
- 无需 API
- 所有处理均在本地完成

当前限制：

- 专注于 x.com 内容提取
- 视频与 GIF 不会作为可播放媒体导出
- 安装或更新扩展后可能需要刷新页面
- 如果 x.com 大幅修改页面结构，部分功能可能失效

这是一个开源项目。
tweet2md 是独立工具，与 X 或 x.com 无关联。
```

## Arabic (ar)

```text
tweet2md هو إضافة Chrome مفتوحة المصدر تقوم بتحويل محتوى x.com إلى Markdown جاهز للاستخدام في البحث، تدوين الملاحظات، سير عمل الذكاء الاصطناعي، والأرشفة دون اتصال.

ما الجديد؟

اطّلع على آخر التحديثات والإصدارات:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

الميزات الرئيسية:

- ثلاث طرق للتشغيل: نافذة منبثقة، زر مدمج داخل التغريدة، أو قائمة النقر بزر الفأرة الأيمن
- نسخ Markdown أو تنزيله أو إرساله إلى Obsidian
- زر إضافة إلى Obsidian بنقرة واحدة
- مجلد فرعي اختياري داخل الـ Vault لربط Obsidian: تُحفظ الملاحظات داخل مجلد محدد (مثل Tweets أو Inbox/Tweets) — اتركه فارغًا لاستخدام جذر الـ Vault
- frontmatter متوافق مع Obsidian
- التقاط بطاقات الروابط داخل التغريدات
- دعم كامل لمقالات X الطويلة
- استخراج التغريدات والسلاسل والاقتباسات بصيغة Markdown
- الحفاظ على البنية والسياق الأصلي
- نافذة متعددة الواجهات
- إظهار أو إخفاء الزر المدمج
- إمكانية نسخ Markdown بدل تنزيله
- إغلاق التبويبات تلقائيًا بعد التصدير
- تنزيل الصور والوسائط محليًا
- مجلد فرعي اختياري داخل التنزيلات: تُحفظ ملفات Markdown والصور داخل مجلد فرعي مختار بدلاً من مجلد التنزيلات مباشرةً
- YAML frontmatter غني بالبيانات الوصفية
- صف تفاعلات اختياري بأسلوب X
- توسيع المنشورات المقتطعة تلقائيًا
- واجهة متعددة اللغات
- دعم الوضع الفاتح والداكن

مناسب لـ:

- استيراد محتوى X إلى Obsidian أو Notion أو Logseq أو Hugo
- تصدير النصوص إلى أدوات الذكاء الاصطناعي
- أرشفة سلاسل البحث والمقالات
- بناء Second Brain قابل للبحث
- تجهيز المواد للكتابة أو الترجمة

لماذا تستخدمه؟

- سير عمل بنقرة واحدة
- تكامل قوي مع Obsidian
- Markdown منظم وسهل التعديل
- أرشفة محلية للصور
- لا يحتاج إلى API
- جميع العمليات تتم محليًا دون تتبع أو إرسال بيانات

القيود الحالية:

- يركز على استخراج محتوى x.com
- لا يتم تصدير الفيديوهات وملفات GIF كوسائط قابلة للتشغيل
- قد تحتاج إلى إعادة تحميل الصفحة بعد تثبيت الإضافة أو تحديثها
- قد تتوقف بعض الوظائف إذا غيّر x.com بنية صفحاته بشكل كبير

هذا مشروع مفتوح المصدر.
tweet2md أداة مستقلة وغير تابعة لـ X أو x.com.
```

## Persian (fa)

```text
tweet2md یک افزونه متن‌باز Chrome است که محتوای x.com را برای پژوهش، یادداشت‌برداری، جریان‌های کاری هوش مصنوعی و آرشیو آفلاین به Markdown آماده تولید تبدیل می‌کند.

تغییرات جدید

آخرین به‌روزرسانی‌ها و نسخه‌ها:
https://github.com/zendegani/tweet2md/blob/main/CHANGELOG.md

ویژگی‌های اصلی:

- سه روش اجرا: پنجره افزونه، دکمه درون‌خطی در توییت‌ها و منوی راست‌کلیک
- کپی Markdown، دانلود فایل یا ارسال به Obsidian
- افزودن به Obsidian تنها با یک کلیک
- زیرپوشهٔ اختیاری Vault برای ارسال به Obsidian: یادداشت‌ها در پوشهٔ مشخص ذخیره می‌شوند (مثلاً Tweets یا Inbox/Tweets) — برای ریشهٔ Vault خالی بگذارید
- frontmatter سازگار با Obsidian
- دریافت کارت لینک‌های توییت
- پشتیبانی کامل از مقالات بلند X
- استخراج توییت‌ها، رشته‌ها و نقل‌قول‌ها به Markdown تمیز
- حفظ ساختار و زمینه پست‌های نقل‌شده
- پنجره چندبخشی برای تنظیمات و عملیات اصلی
- امکان نمایش یا مخفی کردن دکمه درون‌خطی
- امکان کپی به‌جای دانلود توسط دکمه درون‌خطی
- بستن خودکار تب‌ها پس از خروجی گرفتن
- دانلود محلی تصاویر و رسانه‌ها
- زیرپوشهٔ اختیاری دانلودها: فایل‌های Markdown و تصاویر در زیرپوشهٔ انتخاب‌شده ذخیره می‌شوند به‌جای پوشهٔ اصلی بارگیری‌ها
- YAML frontmatter غنی همراه با متادیتا
- ردیف آماری شبیه X به‌صورت اختیاری
- باز کردن خودکار پست‌های کوتاه‌شده
- رابط کاربری چندزبانه
- پشتیبانی از حالت روشن و تاریک

مناسب برای:

- وارد کردن محتوای X به Obsidian، Notion، Logseq یا Hugo
- خروجی گرفتن متن برای مدل‌های زبانی و RAG
- آرشیو آفلاین رشته‌های پژوهشی و مقالات
- ساخت Second Brain قابل جستجو
- آماده‌سازی منابع برای نوشتن یا ترجمه

چرا از آن استفاده کنیم؟

- گردش کار سریع با یک کلیک
- یکپارچگی عالی با Obsidian
- خروجی Markdown تمیز و ساختاریافته
- آرشیو محلی تصاویر برای جلوگیری از خراب شدن لینک‌ها
- بدون نیاز به API
- همه پردازش‌ها به‌صورت محلی انجام می‌شود

محدودیت‌های فعلی:

- متمرکز بر استخراج محتوای x.com
- ویدیوها و GIFها به‌صورت فایل قابل پخش ذخیره نمی‌شوند
- پس از نصب یا به‌روزرسانی افزونه ممکن است نیاز به بارگذاری مجدد صفحه باشد
- در صورت تغییر اساسی ساختار x.com برخی قابلیت‌ها ممکن است از کار بیفتند

این یک پروژه متن‌باز است.
tweet2md ابزاری مستقل است و وابستگی‌ای به X یا x.com ندارد.
```
