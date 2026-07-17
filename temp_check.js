
(function(){
  var SUPABASE_URL = 'https://twblartdcnmenbzkkset.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3YmxhcnRkY25tZW5iemtrc2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMDAyODYsImV4cCI6MjA5OTY3NjI4Nn0._diS8l-mSYCVbjwztpUG4ScqaB4U9Hr-eJ_w_edUFA8';
  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var state = {
    books: [],
    chapters: [],
    checkins: [],          // array of 'YYYY-MM-DD' strings, unique
    view: 'library',        // 'library' | 'book' | 'checkin'
    selectedBookId: null,
    showAddBook: false,
    openChapterId: null,
    editingChapterId: null, // chapter currently in edit form
    showAddChapter: false,
    pendingDelete: null,    // { type:'book'|'chapter', id }
    loaded: false,
    libraryFilter: 'all',   // 'all' | 'want' | 'reading' | 'done'
    searchQuery: '',
    draftBookTitle: '',
    draftBookAuthor: '',
    draftBookStatus: 'want',
    draftBookProgress: 0,
    session: null,
    authMode: 'login',      // 'login' | 'register'
    authEmail: '',
    authError: '',
    authLoading: false
  };

  var STATUS_META = {
    want:    { label: '想读', chipClass: 'status-want' },
    reading: { label: '在读', chipClass: 'status-reading' },
    done:    { label: '读完', chipClass: 'status-done' }
  };

  var SPINE_COLORS = ['navy','moss','gold','rose','teal'];
  var draggedChapterId = null;
  function spineColorFor(id){
    var hash = 0;
    for (var i=0;i<id.length;i++){ hash = (hash*31 + id.charCodeAt(i)) >>> 0; }
    return SPINE_COLORS[hash % SPINE_COLORS.length];
  }

  function uid(){
    return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function getMotto(){
    return localStorage.getItem('bookshelf_motto') || '';
  }
  function setMotto(text){
    localStorage.setItem('bookshelf_motto', text);
  }
  function getMottoDisplay(){
    var m = getMotto();
    return m ? '<span class="motto-display" data-action="edit-motto">' + escapeHtml(m) + '</span>' : '<span class="motto-empty" data-action="edit-motto">添加座右铭</span>';
  }

  function escapeHtml(str){
    return (str || '').replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function showToast(msg){
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove('show'); }, 1800);
  }

  async function loadData(){
    var sessionRes = await supabaseClient.auth.getSession();
    state.session = sessionRes.data ? sessionRes.data.session : null;
    state.loaded = true;

    supabaseClient.auth.onAuthStateChange(function(event, session){
      state.session = session;
      if (event === 'SIGNED_IN'){
        loadUserData();
      } else if (event === 'SIGNED_OUT'){
        state.books = [];
        state.chapters = [];
        state.checkins = [];
        state.view = 'library';
        state.selectedBookId = null;
        render();
      }
    });

    if (state.session){
      showToast('加载中...');
      await loadUserData();
    } else {
      render();
    }
  }

  async function loadUserData(){
    try{
      var userId = state.session.user.id;
      var result = await supabaseClient
        .from('user_data')
        .select('data')
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) throw result.error;
      if (result.data && result.data.data){
        state.books = result.data.data.books || [];
        state.chapters = result.data.data.chapters || [];
        state.checkins = result.data.data.checkins || [];
      } else {
        state.books = [];
        state.chapters = [];
        state.checkins = [];
      }
    }catch(e){
      showToast('读取云端数据失败，请检查网络后重试');
    }
    render();
  }

  async function persist(){
    if (!state.session) return;
    try{
      var userId = state.session.user.id;
      var result = await supabaseClient
        .from('user_data')
        .upsert({
          user_id: userId,
          data: { books: state.books, chapters: state.chapters, checkins: state.checkins },
          updated_at: new Date().toISOString()
        });
      if (result.error) throw result.error;
    }catch(e){
      showToast('保存失败，请检查网络后重试');
    }
  }

  /* ---------- auth ---------- */

  function translateAuthError(msg){
    if (!msg) return '出错了，请重试';
    if (msg.indexOf('Invalid login credentials') !== -1) return '邮箱或密码不正确';
    if (msg.indexOf('User already registered') !== -1) return '该邮箱已注册，请直接登录';
    if (msg.indexOf('Email not confirmed') !== -1) return '请先前往邮箱完成验证后再登录';
    if (msg.indexOf('Password should be at least') !== -1) return '密码至少需要 6 位';
    if (msg.indexOf('Unable to validate email address') !== -1) return '邮箱格式不正确';
    return msg;
  }

  async function handleLogin(){
    var emailEl = document.getElementById('auth-email');
    var passEl = document.getElementById('auth-password');
    var email = emailEl ? emailEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    if (!email || !password){
      state.authError = '请填写邮箱和密码';
      render();
      return;
    }
    state.authEmail = email;
    state.authLoading = true;
    state.authError = '';
    render();
    var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    state.authLoading = false;
    if (result.error){
      state.authError = translateAuthError(result.error.message);
      render();
      return;
    }
    state.session = result.data.session;
    await loadUserData();
  }

  async function handleRegister(){
    var emailEl = document.getElementById('auth-email');
    var passEl = document.getElementById('auth-password');
    var email = emailEl ? emailEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    if (!email || !password){
      state.authError = '请填写邮箱和密码';
      render();
      return;
    }
    if (password.length < 6){
      state.authError = '密码至少需要 6 位';
      render();
      return;
    }
    state.authEmail = email;
    state.authLoading = true;
    state.authError = '';
    render();
    var result = await supabaseClient.auth.signUp({ email: email, password: password });
    state.authLoading = false;
    if (result.error){
      state.authError = translateAuthError(result.error.message);
      render();
      return;
    }
    if (result.data.session){
      state.session = result.data.session;
      await loadUserData();
    } else {
      state.authMode = 'login';
      state.authError = '';
      render();
      showToast('注册成功，请查收邮箱完成验证后登录');
    }
  }

  async function handleLogout(){
    await supabaseClient.auth.signOut();
    state.session = null;
    state.books = [];
    state.chapters = [];
    state.checkins = [];
    state.view = 'library';
    state.selectedBookId = null;
    render();
  }

  function getChaptersForBook(bookId){
    return state.chapters
      .filter(function(c){ return c.bookId === bookId; })
      .sort(function(a,b){
        var ao = (typeof a.order === 'number') ? a.order : (a.createdAt || 0);
        var bo = (typeof b.order === 'number') ? b.order : (b.createdAt || 0);
        return ao - bo;
      });
  }

  /* ---------- actions ---------- */

  function addBook(title, author, status, progress){
    var book = {
      id: uid(),
      title: title.trim(),
      author: author.trim(),
      status: status || 'want',
      progress: (status === 'reading') ? clampProgress(progress) : (status === 'done' ? 100 : 0),
      createdAt: Date.now()
    };
    state.books.unshift(book);
    state.showAddBook = false;
    state.draftBookTitle = '';
    state.draftBookAuthor = '';
    state.draftBookStatus = 'want';
    state.draftBookProgress = 0;
    persist();
    render();
    showToast('已添加《' + book.title + '》');
  }

  function clampProgress(v){
    v = parseInt(v, 10);
    if (isNaN(v)) v = 0;
    return Math.max(0, Math.min(100, v));
  }

  function setBookStatus(bookId, status){
    var book = state.books.find(function(b){ return b.id === bookId; });
    if (!book) return;
    book.status = status;
    if (status === 'done') book.progress = 100;
    if (status === 'want') book.progress = 0;
    if (status === 'reading' && (!book.progress || book.progress === 100)) book.progress = book.progress === 100 ? 100 : 0;
    persist();
    render();
  }

  function setBookProgress(bookId, progress){
    var book = state.books.find(function(b){ return b.id === bookId; });
    if (!book) return;
    book.progress = clampProgress(progress);
    if (book.progress >= 100){ book.progress = 100; book.status = 'done'; }
    persist();
    render();
  }

  function deleteBook(bookId){
    state.books = state.books.filter(function(b){ return b.id !== bookId; });
    state.chapters = state.chapters.filter(function(c){ return c.bookId !== bookId; });
    state.pendingDelete = null;
    state.view = 'library';
    state.selectedBookId = null;
    persist();
    render();
    showToast('已删除该书');
  }

  function addChapter(bookId, title, quote, content){
    var existing = getChaptersForBook(bookId);
    var maxOrder = existing.reduce(function(max, c){
      return Math.max(max, (typeof c.order === 'number') ? c.order : 0);
    }, -1);
    var chapter = {
      id: uid(),
      bookId: bookId,
      title: title.trim(),
      quote: (quote || '').trim(),
      content: content.trim(),
      order: maxOrder + 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.chapters.push(chapter);
    state.showAddChapter = false;
    state.openChapterId = chapter.id;
    persist();
    render();
    showToast('已添加章节');
  }

  function reorderChapters(bookId, draggedId, targetId, insertAfter){
    var ordered = getChaptersForBook(bookId);
    var draggedIdx = ordered.findIndex(function(c){ return c.id === draggedId; });
    if (draggedIdx === -1) return;
    var dragged = ordered.splice(draggedIdx, 1)[0];
    var targetIdx = ordered.findIndex(function(c){ return c.id === targetId; });
    if (targetIdx === -1){
      ordered.push(dragged);
    } else {
      ordered.splice(insertAfter ? targetIdx + 1 : targetIdx, 0, dragged);
    }
    ordered.forEach(function(c, idx){ c.order = idx; });
    persist();
    render();
  }

  function updateChapter(chapterId, title, quote, content){
    var ch = state.chapters.find(function(c){ return c.id === chapterId; });
    if (ch){
      ch.title = title.trim();
      ch.quote = (quote || '').trim();
      ch.content = content.trim();
      ch.updatedAt = Date.now();
    }
    state.editingChapterId = null;
    persist();
    render();
    showToast('已保存');
  }

  function deleteChapter(chapterId){
    state.chapters = state.chapters.filter(function(c){ return c.id !== chapterId; });
    state.pendingDelete = null;
    persist();
    render();
    showToast('已删除该章节');
  }

  /* ---------- check-in ---------- */

  function todayStr(){
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function dateStrOffset(offsetDays){
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function isCheckedIn(dateStr){
    return state.checkins.indexOf(dateStr) !== -1;
  }

  function toggleTodayCheckin(){
    var today = todayStr();
    if (isCheckedIn(today)) return; // already checked in, no toggling off
    state.checkins.push(today);
    persist();
    render();
    showToast('打卡成功，继续加油！');
  }

  function getCurrentStreak(){
    var streak = 0;
    var offset = 0;
    // if today not checked in yet, start counting from yesterday
    if (!isCheckedIn(todayStr())){
      offset = -1;
    }
    while (isCheckedIn(dateStrOffset(offset))){
      streak++;
      offset--;
    }
    return streak;
  }

  function getCheckinCalendarDays(numDays){
    var days = [];
    for (var i = numDays - 1; i >= 0; i--){
      var ds = dateStrOffset(-i);
      days.push({ date: ds, filled: isCheckedIn(ds), isToday: (i === 0) });
    }
    return days;
  }


  /* ---------- rendering ---------- */

  function render(){
    var app = document.getElementById('app');
    if (!state.loaded){
      app.innerHTML = '<div class="loading-state">正在打开书架…</div>';
      return;
    }
    if (!state.session){
      app.innerHTML = renderAuthScreen();
      bindEvents();
      return;
    }
    if (state.view === 'book' && state.selectedBookId){
      app.innerHTML = renderHeader() + renderBookDetail();
    } else if (state.view === 'checkin'){
      app.innerHTML = renderHeader() + renderCheckinDetail();
    } else {
      app.innerHTML = renderHeader() + renderLibrary();
    }
    bindEvents();
  }

  function renderAuthScreen(){
    var mode = state.authMode;
    return ''
    + '<div class="auth-wrap">'
    +   '<div class="brand">'
    +     '<div class="brand-mark"></div>'
    +     '<div><h1 class="serif">书斋</h1><p>记录读过的每一本书，梳理每一章的收获</p></div>'
    +   '</div>'
    +   '<div class="panel">'
    +     '<div class="auth-tabs">'
    +       '<button class="auth-tab ' + (mode==='login'?'active':'') + '" data-action="switch-auth-mode" data-mode="login">登录</button>'
    +       '<button class="auth-tab ' + (mode==='register'?'active':'') + '" data-action="switch-auth-mode" data-mode="register">注册</button>'
    +     '</div>'
    + (state.authError ? '<div class="auth-error">' + escapeHtml(state.authError) + '</div>' : '')
    +     '<div class="field"><label>邮箱</label><input type="email" id="auth-email" placeholder="you@example.com" value="' + escapeHtml(state.authEmail) + '" autofocus></div>'
    +     '<div class="field"><label>密码</label><input type="password" id="auth-password" placeholder="至少 6 位" value=""></div>'
    +     '<button class="btn btn-primary btn-full" data-action="' + (mode==='login'?'submit-login':'submit-register') + '"' + (state.authLoading ? ' disabled' : '') + '>'
    +       (state.authLoading ? '请稍候…' : (mode==='login' ? '登录' : '注册'))
    +     '</button>'
    +   '</div>'
    +   '<p class="auth-hint">' + (mode==='login' ? '还没有账号？点上方"注册"创建一个。' : '数据只有你登录后能看到，请牢记密码。') + '</p>'
    + '</div>';
  }

  function renderHeader(){
    var userEmail = (state.session && state.session.user) ? state.session.user.email : '';
    return ''
    + '<div class="app-header">'
    +   '<div class="brand">'
    +     '<div class="brand-mark"></div>'
    +     '<h1 class="serif">书斋</h1>'
    +   '</div>'
    +   '<div class="header-actions">'
    +     '<span class="user-email-btn" data-action="toggle-user-menu">' + escapeHtml(userEmail) + '</span>'
    +     '<div class="user-dropdown" id="user-dropdown" style="display:none;">'
    +       '<button class="btn btn-ghost btn-sm" data-action="logout">退出登录</button>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + (state.view === 'library' && state.books.length > 0
      ? '<div class="search-box">'
        + '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
        + '<input type="text" id="search-input" placeholder="搜索书名、作者或笔记内容" value="' + escapeHtml(state.searchQuery) + '">'
        + (state.searchQuery ? '<button class="search-clear" data-action="clear-search" aria-label="清除搜索"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' : '')
        + '</div>'
      : '');
  }

  function renderLibrary(){
    var html = '';
    if (state.showAddBook){
      html += renderAddBookForm();
    }
    var query = (state.searchQuery || '').trim();
    if (query && !state.showAddBook){
      return html + renderSearchResults(query);
    }
    if (state.books.length === 0 && !state.showAddBook){
      html += ''
      + '<div class="empty">'
      +   '<h2 class="serif">书架空空如也</h2>'
      +   '<p>添加第一本正在读的书，开始记录你的阅读笔记。</p>'
      +   '<button class="btn btn-primary btn-sm" data-action="open-add-book"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>添加书本</button>'
      + '</div>';
      return html;
    }
    if (state.books.length > 0){
      var counts = { all: state.books.length, want: 0, reading: 0, done: 0 };
      state.books.forEach(function(b){ counts[b.status || 'want']++; });

      // 第一行：座右铭
      html += '<div class="motto-row">' + getMottoDisplay() + '</div>';

      // 第二行：筛选标签 + 打卡 + 添加书本
      var streak = getCurrentStreak();
      var checkedToday = isCheckedIn(todayStr());
      html += '<div class="shelf-actions">'
        + '<div class="filter-tabs">'
        + renderFilterTab('all', '全部', counts.all)
        + renderFilterTab('want', '想读', counts.want)
        + renderFilterTab('reading', '在读', counts.reading)
        + renderFilterTab('done', '读完', counts.done)
        + '</div>'
        + '<div class="checkin-mini">'
        +   '<span class="streak-text" data-action="open-checkin-detail">' + streak + ' 天</span>'
        +   '<button class="checkin-btn ' + (checkedToday ? 'done' : '') + '" data-action="checkin-today"' + (checkedToday ? ' disabled' : '') + '>'
        +     (checkedToday ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>已打卡' : '打卡')
        +   '</button>'
        + '</div>'
        + '<button class="btn btn-primary btn-sm" data-action="open-add-book"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>'
        + '</div>';

      var visibleBooks = state.books.filter(function(b){
        return state.libraryFilter === 'all' || (b.status || 'want') === state.libraryFilter;
      });

      if (visibleBooks.length === 0){
        html += '<div class="empty" style="padding:48px 20px;"><p style="margin:0;">这个分类下暂时没有书。</p></div>';
        return html;
      }

      html += '<div class="grid">';
      visibleBooks.forEach(function(b){
        var count = getChaptersForBook(b.id).length;
        var color = spineColorFor(b.id);
        var status = b.status || 'want';
        var meta = STATUS_META[status];
        var progress = clampProgress(b.progress || 0);
        html += ''
        + '<div class="book-card" data-action="open-book" data-id="' + b.id + '">'
        +   '<div class="spine" style="background:var(--' + color + ')"></div>'
        +   '<h3 class="serif">' + escapeHtml(b.title) + '</h3>'
        +   (b.author ? '<p class="author">' + escapeHtml(b.author) + '</p>' : '<p class="author" style="opacity:.5">未填写作者</p>')
        +   '<div class="book-meta">'
        +     '<span>' + (count > 0 ? count + ' 个章节' : '暂无章节') + '</span>'
        +     '<span class="status-chip ' + meta.chipClass + '">' + meta.label + '</span>'
        +   '</div>'
        +   (status === 'reading' ? '<div class="progress-track"><div class="progress-fill" style="width:' + progress + '%"></div></div>' : '')
        + '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderDashboard(){
    var counts = { all: state.books.length, want: 0, reading: 0, done: 0 };
    state.books.forEach(function(b){ counts[b.status || 'want']++; });

    var streak = getCurrentStreak();
    var checkedToday = isCheckedIn(todayStr());

    return ''
    + '<div class="dashboard">'
    +   '<div class="stats-row">'
    +     '<span class="total-books">📚 ' + counts.all + ' 本</span>'
    +     '<div class="checkin-line">'
    +       '<span class="streak-text" data-action="open-checkin-detail">连续打卡 ' + streak + ' 天</span>'
    +       '<button class="checkin-btn ' + (checkedToday ? 'done' : '') + '" data-action="checkin-today"' + (checkedToday ? ' disabled' : '') + '>'
    +         (checkedToday ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>已打卡' : '打卡')
    +       '</button>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  }

  function renderCheckinDetail(){
    var streak = getCurrentStreak();
    var totalCheckins = state.checkins.length;

    // 生成当月日历
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthName = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });

    var calendarHtml = '<div class="checkin-calendar">';
    // 星期标签
    ['日','一','二','三','四','五','六'].forEach(function(d){
      calendarHtml += '<div class="weekday-label">' + d + '</div>';
    });
    // 空白格子
    for (var i = 0; i < firstDay; i++){
      calendarHtml += '<div class="checkin-day empty"></div>';
    }
    // 日期格子
    for (var d = 1; d <= daysInMonth; d++){
      var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var filled = isCheckedIn(dateStr);
      var isToday = (d === now.getDate());
      var cls = 'checkin-day' + (filled ? ' filled' : '') + (isToday && !filled ? ' today' : '');
      calendarHtml += '<div class="' + cls + '">' + d + '</div>';
    }
    calendarHtml += '</div>';

    return ''
    + '<div class="checkin-detail-header">'
    +   '<button class="back-link" data-action="back-to-library">'
    +     '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>'
    +     '返回书架'
    +   '</button>'
    + '</div>'
    + '<div class="checkin-stats-grid">'
    +   '<div class="checkin-stat-card">'
    +     '<p class="stat-label">连续打卡</p>'
    +     '<p class="stat-value">' + streak + '<span class="stat-unit">天</span></p>'
    +   '</div>'
    +   '<div class="checkin-stat-card">'
    +     '<p class="stat-label">累计打卡</p>'
    +     '<p class="stat-value">' + totalCheckins + '<span class="stat-unit">天</span></p>'
    +   '</div>'
    + '</div>'
    + '<div class="checkin-calendar-section">'
    +   '<h3>' + monthName + '</h3>'
    +   calendarHtml
    + '</div>';
  }

  function renderFilterTab(key, label, count){
    var active = state.libraryFilter === key;
    return '<button class="filter-tab ' + (active ? 'active' : '') + '" data-action="filter-library" data-filter="' + key + '">' + label + ' (' + count + ')</button>';
  }

  function highlight(text, query){
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp('(' + escapedQuery + ')', 'ig'), '<mark>$1</mark>');
  }

  function snippetAround(text, query){
    var lower = text.toLowerCase();
    var idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, 80);
    var start = Math.max(0, idx - 30);
    var end = Math.min(text.length, idx + query.length + 50);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  function renderSearchResults(query){
    var q = query.toLowerCase();
    var hits = [];

    state.books.forEach(function(book){
      var bookMatch = book.title.toLowerCase().indexOf(q) !== -1 || (book.author || '').toLowerCase().indexOf(q) !== -1;
      var chapters = getChaptersForBook(book.id);
      var chapterHitFound = false;

      chapters.forEach(function(ch){
        var inTitle = ch.title.toLowerCase().indexOf(q) !== -1;
        var inQuote = (ch.quote || '').toLowerCase().indexOf(q) !== -1;
        var inContent = (ch.content || '').toLowerCase().indexOf(q) !== -1;
        if (inTitle || inQuote || inContent){
          chapterHitFound = true;
          var snippetSource = inQuote ? ch.quote : (inContent ? ch.content : ch.title);
          hits.push({
            bookId: book.id,
            chapterId: ch.id,
            bookTitle: book.title,
            title: ch.title,
            snippet: snippetAround(snippetSource, query)
          });
        }
      });

      if (bookMatch && !chapterHitFound){
        hits.push({
          bookId: book.id,
          chapterId: null,
          bookTitle: null,
          title: book.title,
          snippet: book.author || ''
        });
      }
    });

    var html = '<div class="shelf-label"><span>找到 ' + hits.length + ' 条结果</span></div>';
    if (hits.length === 0){
      html += '<div class="empty" style="padding:48px 20px;"><p style="margin:0;">没有找到匹配的书本或笔记，换个关键词试试。</p></div>';
      return html;
    }
    html += '<div class="search-results">';
    hits.forEach(function(hit){
      html += '<div class="search-hit" data-action="open-search-hit" data-book-id="' + hit.bookId + '"' + (hit.chapterId ? ' data-chapter-id="' + hit.chapterId + '"' : '') + '>'
        + (hit.bookTitle ? '<p class="hit-book">' + escapeHtml(hit.bookTitle) + '</p>' : '')
        + '<h4>' + highlight(hit.title, query) + '</h4>'
        + (hit.snippet ? '<p>' + highlight(hit.snippet, query) + '</p>' : '')
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderAddBookForm(){
    var status = state.draftBookStatus || 'want';
    return ''
    + '<div class="panel" id="add-book-panel">'
    +   '<h3>添加新书</h3>'
    +   '<div class="field-row">'
    +     '<div class="field"><label>书名</label><input type="text" id="new-book-title" placeholder="例如：三体" maxlength="80" value="' + escapeHtml(state.draftBookTitle) + '" autofocus></div>'
    +     '<div class="field"><label>作者（可选）</label><input type="text" id="new-book-author" placeholder="例如：刘慈欣" maxlength="60" value="' + escapeHtml(state.draftBookAuthor) + '"></div>'
    +   '</div>'
    +   '<div class="field">'
    +     '<label>阅读状态</label>'
    +     '<div class="status-selector">'
    +       '<button type="button" class="status-option ' + (status==='want'?'active':'') + '" data-action="set-draft-status" data-status="want">想读</button>'
    +       '<button type="button" class="status-option ' + (status==='reading'?'active':'') + '" data-action="set-draft-status" data-status="reading">在读</button>'
    +       '<button type="button" class="status-option ' + (status==='done'?'active':'') + '" data-action="set-draft-status" data-status="done">读完</button>'
    +     '</div>'
    +   '</div>'
    + (status === 'reading'
      ? '<div class="field"><label>阅读进度（%）</label><input type="number" id="new-book-progress" min="0" max="100" value="' + clampProgress(state.draftBookProgress) + '"></div>'
      : '')
    +   '<div class="panel-actions">'
    +     '<button class="btn" data-action="cancel-add-book">取消</button>'
    +     '<button class="btn btn-primary" data-action="submit-add-book">保存</button>'
    +   '</div>'
    + '</div>';
  }

  function renderBookDetail(){
    var book = state.books.find(function(b){ return b.id === state.selectedBookId; });
    if (!book){
      state.view = 'library';
      return renderLibrary();
    }
    var chapters = getChaptersForBook(book.id);
    var isDeletingBook = state.pendingDelete && state.pendingDelete.type === 'book' && state.pendingDelete.id === book.id;
    var status = book.status || 'want';
    var progress = clampProgress(book.progress || 0);

    var html = ''
    + '<button class="back-link" data-action="back-to-library"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>返回书架</button>'
    + '<div class="detail-header">'
    +   '<div class="detail-title-row">'
    +     '<div><h2 class="serif">' + escapeHtml(book.title) + '</h2>'
    +     (book.author ? '<p class="author">' + escapeHtml(book.author) + '</p>' : '')
    +     '<div class="status-row">'
    +       '<button type="button" class="status-chip ' + (status==='want'?'status-want':'chip') + '" data-action="set-book-status" data-id="' + book.id + '" data-status="want">想读</button>'
    +       '<button type="button" class="status-chip ' + (status==='reading'?'status-reading':'chip') + '" data-action="set-book-status" data-id="' + book.id + '" data-status="reading">在读</button>'
    +       '<button type="button" class="status-chip ' + (status==='done'?'status-done':'chip') + '" data-action="set-book-status" data-id="' + book.id + '" data-status="done">读完</button>'
    +     '</div>'
    + (status === 'reading'
      ? '<div class="progress-editor" style="max-width:320px;"><input type="range" id="progress-slider" min="0" max="100" step="1" value="' + progress + '" data-id="' + book.id + '"><span class="progress-value" id="progress-value-label">' + progress + '%</span></div>'
      : '')
    +     '</div>'
    +     '<div class="detail-actions">'
    +       '<button class="btn btn-sm" data-action="export-book" data-id="' + book.id + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>导出本书</button>'
    +       '<button class="btn btn-sm ' + (isDeletingBook ? 'confirm-btn' : '') + '" data-action="delete-book" data-id="' + book.id + '">'
    +         (isDeletingBook ? '确认删除整本书？' : '删除书本') + '</button>'
    +     '</div>'
    +   '</div>'
    + '</div>';

    html += '<div class="section-label"><h3>章节笔记</h3><span style="font-size:12px;color:var(--ink-faint)">' + chapters.length + ' 章</span></div>';

    if (chapters.length === 0 && !state.showAddChapter){
      html += '<div class="empty" style="padding:40px 20px;">'
        + '<p style="margin-bottom:16px;">这本书还没有章节，添加第一章开始记录吧。</p>'
        + '<button class="btn btn-primary" data-action="open-add-chapter"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>添加章节</button>'
        + '</div>';
    } else {
      html += '<div class="chapter-list">';
      chapters.forEach(function(ch, idx){
        var isOpen = state.openChapterId === ch.id;
        var isEditing = state.editingChapterId === ch.id;
        var isDeletingCh = state.pendingDelete && state.pendingDelete.type === 'chapter' && state.pendingDelete.id === ch.id;
        html += '<div class="chapter-row ' + (isOpen ? 'open' : '') + '" data-chapter-id="' + ch.id + '">';
        html += '<div class="chapter-head" data-action="toggle-chapter" data-id="' + ch.id + '" draggable="true">'
          + '<svg class="drag-handle" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>'
          + '<div class="chapter-num">' + (idx+1) + '</div>'
          + '<div class="chapter-head-text">'
          +   '<h4>' + escapeHtml(ch.title) + '</h4>'
          +   '<p>' + (ch.content ? escapeHtml(ch.content.slice(0,40)) : '暂无内容') + '</p>'
          + '</div>'
          + '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>'
          + '</div>';
        html += '<div class="chapter-body">';
        if (isEditing){
          html += ''
          + '<div class="field"><label>章节标题</label><input type="text" id="edit-title-' + ch.id + '" value="' + escapeHtml(ch.title) + '" maxlength="80"></div>'
          + '<div class="field"><label>金句摘录（可选）</label><input type="text" id="edit-quote-' + ch.id + '" value="' + escapeHtml(ch.quote || '') + '" placeholder="摘录一句触动你的原文" maxlength="200"></div>'
          + '<div class="field"><label>本章总结</label><textarea id="edit-content-' + ch.id + '" placeholder="写下这一章的要点、感想或摘录…">' + escapeHtml(ch.content) + '</textarea></div>'
          + '<div class="panel-actions" style="margin-top:0;">'
          +   '<button class="btn" data-action="cancel-edit-chapter">取消</button>'
          +   '<button class="btn btn-primary" data-action="save-chapter" data-id="' + ch.id + '">保存</button>'
          + '</div>';
        } else {
          html += (ch.quote ? '<p class="chapter-quote">"' + escapeHtml(ch.quote) + '"</p>' : '');
          html += '<p class="chapter-content ' + (ch.content ? '' : 'empty-note') + '">' + (ch.content ? escapeHtml(ch.content) : '还没有写总结。') + '</p>';
          html += '<div class="chapter-body-actions">'
          + '<button class="btn btn-sm" data-action="edit-chapter" data-id="' + ch.id + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>编辑</button>'
          + '<button class="btn btn-sm ' + (isDeletingCh ? 'confirm-btn' : '') + '" data-action="delete-chapter" data-id="' + ch.id + '">' + (isDeletingCh ? '确认删除？' : '删除') + '</button>'
          + '</div>';
        }
        html += '</div>'; // chapter-body
        html += '</div>'; // chapter-row
      });
      html += '</div>'; // chapter-list

      if (state.showAddChapter){
        html += renderAddChapterForm();
      } else {
        html += '<button class="add-chapter-trigger" data-action="open-add-chapter"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>添加章节</button>';
      }
    }

    return html;
  }

  function renderAddChapterForm(){
    return ''
    + '<div class="panel" id="add-chapter-panel" style="margin-top:14px;">'
    +   '<h3>添加新章节</h3>'
    +   '<div class="field"><label>章节标题</label><input type="text" id="new-chapter-title" placeholder="例如：第一章 大宗师" maxlength="80" autofocus></div>'
    +   '<div class="field"><label>金句摘录（可选）</label><input type="text" id="new-chapter-quote" placeholder="摘录一句触动你的原文" maxlength="200"></div>'
    +   '<div class="field"><label>本章总结</label><textarea id="new-chapter-content" placeholder="写下这一章的要点、感想或摘录…"></textarea></div>'
    +   '<div class="panel-actions">'
    +     '<button class="btn" data-action="cancel-add-chapter">取消</button>'
    +     '<button class="btn btn-primary" data-action="submit-add-chapter">保存</button>'
    +   '</div>'
    + '</div>';
  }

  /* ---------- events ---------- */

  function bindEvents(){
    var app = document.getElementById('app');
    app.onclick = function(e){
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      var id = target.getAttribute('data-id');

      switch(action){
        case 'edit-motto':
          var currentMotto = getMotto();
          var newMotto = prompt('输入你的座右铭（限20字以内）：', currentMotto);
          if (newMotto !== null){
            newMotto = newMotto.trim().slice(0, 20);
            setMotto(newMotto);
            render();
          }
          break;
        case 'open-add-book':
          state.showAddBook = true;
          state.draftBookTitle = '';
          state.draftBookAuthor = '';
          state.draftBookStatus = 'want';
          state.draftBookProgress = 0;
          render();
          setTimeout(function(){ var el = document.getElementById('new-book-title'); if (el) el.focus(); }, 0);
          break;
        case 'cancel-add-book':
          state.showAddBook = false;
          render();
          break;
        case 'submit-add-book':
          submitAddBook();
          break;
        case 'set-draft-status':
          syncDraftBookFromDom();
          state.draftBookStatus = target.getAttribute('data-status');
          render();
          setTimeout(function(){ var el = document.getElementById('new-book-title'); if (el) el.focus(); }, 0);
          break;
        case 'filter-library':
          state.libraryFilter = target.getAttribute('data-filter');
          render();
          break;
        case 'set-book-status':
          setBookStatus(id, target.getAttribute('data-status'));
          break;
        case 'open-book':
          state.view = 'book';
          state.selectedBookId = id;
          state.openChapterId = null;
          state.editingChapterId = null;
          state.showAddChapter = false;
          state.pendingDelete = null;
          render();
          window.scrollTo(0,0);
          break;
        case 'back-to-library':
          state.view = 'library';
          state.selectedBookId = null;
          state.pendingDelete = null;
          render();
          break;
        case 'delete-book':
          if (state.pendingDelete && state.pendingDelete.type === 'book' && state.pendingDelete.id === id){
            deleteBook(id);
          } else {
            state.pendingDelete = {type:'book', id:id};
            render();
          }
          break;
        case 'open-add-chapter':
          state.showAddChapter = true;
          render();
          setTimeout(function(){ var el = document.getElementById('new-chapter-title'); if (el) el.focus(); }, 0);
          break;
        case 'cancel-add-chapter':
          state.showAddChapter = false;
          render();
          break;
        case 'submit-add-chapter':
          submitAddChapter();
          break;
        case 'toggle-chapter':
          if (state.editingChapterId === id) break;
          if (e.target.closest('.drag-handle')) break;
          state.openChapterId = (state.openChapterId === id) ? null : id;
          render();
          break;
        case 'edit-chapter':
          state.openChapterId = id;
          state.editingChapterId = id;
          render();
          setTimeout(function(){ var el = document.getElementById('edit-content-' + id); if (el) el.focus(); }, 0);
          break;
        case 'cancel-edit-chapter':
          state.editingChapterId = null;
          render();
          break;
        case 'save-chapter':
          submitEditChapter(id);
          break;
        case 'delete-chapter':
          if (state.pendingDelete && state.pendingDelete.type === 'chapter' && state.pendingDelete.id === id){
            deleteChapter(id);
          } else {
            state.pendingDelete = {type:'chapter', id:id};
            render();
          }
          break;
        case 'clear-search':
          state.searchQuery = '';
          render();
          break;
        case 'open-search-hit':
          state.view = 'book';
          state.selectedBookId = target.getAttribute('data-book-id');
          state.openChapterId = target.getAttribute('data-chapter-id') || null;
          state.editingChapterId = null;
          state.showAddChapter = false;
          state.pendingDelete = null;
          state.searchQuery = '';
          render();
          window.scrollTo(0,0);
          break;
        case 'export-all':
          exportMarkdown();
          break;
        case 'export-book':
          exportMarkdown(id);
          break;
        case 'switch-auth-mode':
          state.authMode = target.getAttribute('data-mode');
          state.authError = '';
          render();
          setTimeout(function(){ var el = document.getElementById('auth-email'); if (el) el.focus(); }, 0);
          break;
        case 'open-checkin-detail':
          state.view = 'checkin';
          render();
          window.scrollTo(0,0);
          break;
        case 'checkin-today':
          toggleTodayCheckin();
          break;
        case 'submit-login':
          handleLogin();
          break;
        case 'submit-register':
          handleRegister();
          break;
        case 'toggle-user-menu':
          var dropdown = document.getElementById('user-dropdown');
          if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
          break;
        case 'logout':
          handleLogout();
          break;
      }
    };

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', function(e){
      if (!e.target.closest('.header-actions')){
        var dropdown = document.getElementById('user-dropdown');
        if (dropdown) dropdown.style.display = 'none';
      }
    });

    // Enter-to-submit on auth password field
    var authPassword = document.getElementById('auth-password');
    if (authPassword){
      authPassword.addEventListener('keydown', function(e){
        if (e.key === 'Enter'){
          if (state.authMode === 'login') handleLogin(); else handleRegister();
        }
      });
    }

    // Enter-to-submit on single-line title inputs
    var newBookTitle = document.getElementById('new-book-title');
    if (newBookTitle){
      newBookTitle.addEventListener('keydown', function(e){ if (e.key === 'Enter') submitAddBook(); });
    }
    var newChapterTitle = document.getElementById('new-chapter-title');
    if (newChapterTitle){
      newChapterTitle.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); document.getElementById('new-chapter-content').focus(); } });
    }

    // reading-progress slider: live label update + persist on release
    var slider = document.getElementById('progress-slider');
    if (slider){
      slider.addEventListener('input', function(){
        var label = document.getElementById('progress-value-label');
        if (label) label.textContent = slider.value + '%';
      });
      slider.addEventListener('change', function(){
        setBookProgress(slider.getAttribute('data-id'), slider.value);
      });
    }

    // search input: re-render results while preserving cursor/focus
    // (ignore input events fired during IME composition so Chinese/Japanese/Korean typing isn't interrupted)
    var searchInput = document.getElementById('search-input');
    if (searchInput){
      var isComposing = false;
      function handleSearchInput(){
        var cursor = searchInput.selectionStart;
        state.searchQuery = searchInput.value;
        render();
        var el = document.getElementById('search-input');
        if (el){ el.focus(); el.setSelectionRange(cursor, cursor); }
      }
      searchInput.addEventListener('compositionstart', function(){ isComposing = true; });
      searchInput.addEventListener('compositionend', function(){
        isComposing = false;
        handleSearchInput();
      });
      searchInput.addEventListener('input', function(e){
        if (isComposing || e.isComposing) return;
        handleSearchInput();
      });
    }

    // chapter drag-to-reorder
    app.ondragstart = function(e){
      var handle = e.target.closest('.chapter-head');
      if (!handle){ e.preventDefault(); return; }
      var row = handle.closest('.chapter-row');
      if (!row) return;
      draggedChapterId = row.getAttribute('data-chapter-id');
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', draggedChapterId); }catch(err){}
      setTimeout(function(){ row.classList.add('dragging'); }, 0);
    };
    app.ondragover = function(e){
      if (!draggedChapterId) return;
      var row = e.target.closest('.chapter-row');
      if (!row) return;
      e.preventDefault();
      clearDragOverClasses();
      var rect = row.getBoundingClientRect();
      var isTopHalf = (e.clientY - rect.top) < rect.height / 2;
      row.classList.add(isTopHalf ? 'drag-over-top' : 'drag-over-bottom');
    };
    app.ondrop = function(e){
      if (!draggedChapterId) return;
      var row = e.target.closest('.chapter-row');
      clearDragOverClasses();
      if (row){
        e.preventDefault();
        var targetId = row.getAttribute('data-chapter-id');
        var rect = row.getBoundingClientRect();
        var insertAfter = (e.clientY - rect.top) >= rect.height / 2;
        if (targetId !== draggedChapterId){
          reorderChapters(state.selectedBookId, draggedChapterId, targetId, insertAfter);
        }
      }
      draggedChapterId = null;
    };
    app.ondragend = function(){
      draggedChapterId = null;
      clearDragOverClasses();
      var draggingEl = document.querySelector('.chapter-row.dragging');
      if (draggingEl) draggingEl.classList.remove('dragging');
    };
  }

  function clearDragOverClasses(){
    var els = document.querySelectorAll('.chapter-row.drag-over-top, .chapter-row.drag-over-bottom');
    for (var i=0;i<els.length;i++){ els[i].classList.remove('drag-over-top','drag-over-bottom'); }
  }

  function buildMarkdown(bookIdFilter){
    var books = bookIdFilter ? state.books.filter(function(b){ return b.id === bookIdFilter; }) : state.books;
    var lines = ['# 书斋读书笔记', ''];
    books.forEach(function(b){
      var meta = STATUS_META[b.status || 'want'];
      lines.push('## ' + b.title + (b.author ? '（' + b.author + '）' : ''));
      lines.push('');
      lines.push('- 状态：' + meta.label + (b.status === 'reading' ? '，进度 ' + clampProgress(b.progress || 0) + '%' : ''));
      lines.push('');
      var chapters = getChaptersForBook(b.id);
      if (chapters.length === 0){
        lines.push('_暂无章节笔记_');
        lines.push('');
      } else {
        chapters.forEach(function(ch, idx){
          lines.push('### ' + (idx + 1) + '. ' + ch.title);
          if (ch.quote){
            lines.push('> ' + ch.quote);
            lines.push('');
          }
          lines.push(ch.content || '_暂无总结_');
          lines.push('');
        });
      }
    });
    return lines.join('\n');
  }

  function exportMarkdown(bookIdFilter){
    if (state.books.length === 0){
      showToast('还没有可导出的内容');
      return;
    }
    var md = buildMarkdown(bookIdFilter);
    var targetBook = bookIdFilter ? state.books.find(function(b){ return b.id === bookIdFilter; }) : null;
    var filename = targetBook ? (targetBook.title + '-读书笔记.md') : '书斋读书笔记.md';
    try{
      var blob = new Blob([md], {type: 'text/markdown;charset=utf-8'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      showToast('已导出 Markdown 文件');
    }catch(e){
      showToast('导出失败，请重试');
    }
  }

  function syncDraftBookFromDom(){
    var titleEl = document.getElementById('new-book-title');
    var authorEl = document.getElementById('new-book-author');
    var progressEl = document.getElementById('new-book-progress');
    if (titleEl) state.draftBookTitle = titleEl.value;
    if (authorEl) state.draftBookAuthor = authorEl.value;
    if (progressEl) state.draftBookProgress = clampProgress(progressEl.value);
  }

  function submitAddBook(){
    var titleEl = document.getElementById('new-book-title');
    var authorEl = document.getElementById('new-book-author');
    var progressEl = document.getElementById('new-book-progress');
    var title = titleEl ? titleEl.value : '';
    if (!title || !title.trim()){
      showToast('请填写书名');
      if (titleEl) titleEl.focus();
      return;
    }
    addBook(title, authorEl ? authorEl.value : '', state.draftBookStatus || 'want', progressEl ? progressEl.value : state.draftBookProgress);
  }

  function submitAddChapter(){
    var titleEl = document.getElementById('new-chapter-title');
    var quoteEl = document.getElementById('new-chapter-quote');
    var contentEl = document.getElementById('new-chapter-content');
    var title = titleEl ? titleEl.value : '';
    if (!title || !title.trim()){
      showToast('请填写章节标题');
      if (titleEl) titleEl.focus();
      return;
    }
    addChapter(state.selectedBookId, title, quoteEl ? quoteEl.value : '', contentEl ? contentEl.value : '');
  }

  function submitEditChapter(chapterId){
    var titleEl = document.getElementById('edit-title-' + chapterId);
    var quoteEl = document.getElementById('edit-quote-' + chapterId);
    var contentEl = document.getElementById('edit-content-' + chapterId);
    var title = titleEl ? titleEl.value : '';
    if (!title || !title.trim()){
      showToast('请填写章节标题');
      if (titleEl) titleEl.focus();
      return;
    }
    updateChapter(chapterId, title, quoteEl ? quoteEl.value : '', contentEl ? contentEl.value : '');
  }

  loadData();
})();
