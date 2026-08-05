(() => {
  const modeButtons = [...document.querySelectorAll("[data-journey-mode]")];
  const panels = [...document.querySelectorAll("[data-journey-panel]")];
  const filterButtons = [...document.querySelectorAll("[data-mission-filter]")];
  const fallbackMissions = [...document.querySelectorAll("[data-mission-type]")];
  const missionContainer = document.querySelector(".journey-missions");
  const rewardTrack = document.querySelector(".journey-level-track");
  const rewardScroller = document.querySelector(".journey-level-scroll");
  const title = document.getElementById("journeyMissionTitle");
  const hint = document.getElementById("journeyMissionHint");
  const shell = document.querySelector(".journey-shell");
  const authGate = document.getElementById("battlepassAuthGate");
  const loginButton = document.getElementById("steamLoginButton");
  const steamAccount = document.getElementById("steamAccount");
  const demoMode = document.body.dataset.battlepassDemo === "true";

  const copy = {
    ko: {
      daily: ["금일 임무", "매일 초기화되는 임무입니다.", "일일"],
      weekly: ["이번 주 임무", "주간 초기화 전까지 완료할 수 있습니다.", "주간"],
      season: ["이번 시즌 임무", "시즌 종료 전까지 누적 진행되는 임무입니다.", "시즌"]
    },
    en: {
      daily: ["Daily Missions", "These missions reset every day.", "DAILY"],
      weekly: ["Weekly Missions", "Complete these before the weekly reset.", "WEEKLY"],
      season: ["Season Missions", "Progress is accumulated until the season ends.", "SEASON"]
    },
    jp: {
      daily: ["Daily Missions", "These missions reset every day.", "DAILY"],
      weekly: ["Weekly Missions", "Complete these before the weekly reset.", "WEEKLY"],
      season: ["Season Missions", "Progress is accumulated until the season ends.", "SEASON"]
    }
  };

  let activeFilter = "daily";
  let battlePassData = null;

  function getLanguage() {
    const language = new URL(location.href).searchParams.get("lang");
    return ["ko", "en", "jp"].includes(language) ? language : "ko";
  }

  function localize(value) {
    if (typeof value === "string") return value;
    const language = getLanguage();
    return value?.[language] ?? value?.ko ?? value?.en ?? "";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(getLanguage() === "ko" ? "ko-KR" : "en-US").format(value);
  }

  function claimedRewardLabel() {
    return getLanguage() === "ko" ? "수령 완료" : "CLAIMED";
  }

  function clampPercent(current, target) {
    if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function setMode(mode) {
    modeButtons.forEach(button => {
      const active = button.dataset.journeyMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.journeyPanel !== mode; });
  }

  function createMissionCard(mission, type) {
    const percentage = clampPercent(mission.progress, mission.target);
    const article = makeElement("article", "journey-mission " + type + (percentage >= 100 ? " complete" : ""));
    article.dataset.missionType = type;
    article.dataset.missionId = mission.id;

    const header = makeElement("header");
    header.append(makeElement("strong", "", "+" + formatNumber(mission.xp) + " XP"));

    const heading = makeElement("h3", "", localize(mission.title));
    const meter = makeElement("div", "journey-meter");
    const meterFill = makeElement("i");
    meterFill.style.setProperty("--progress", percentage + "%");
    meter.append(meterFill);

    const footer = makeElement("footer");
    footer.append(
      makeElement("span", "", formatNumber(mission.progress) + " / " + formatNumber(mission.target)),
      makeElement("b", "", percentage + "%")
    );

    article.append(header, heading, meter, footer);
    return article;
  }

  function renderMissions(filter) {
    if (!battlePassData) {
      fallbackMissions.forEach(mission => {
        mission.hidden = mission.dataset.missionType !== filter;
      });
      return;
    }

    const missionCards = (battlePassData.missions[filter] || [])
      .map(mission => createMissionCard(mission, filter));
    missionContainer.replaceChildren(...missionCards);
  }

  function createRewardColumn(reward, player) {
    const claimed = player.claimedRewards.includes(reward.level);
    const current = reward.level === player.passLevel;
    const column = makeElement("li", "journey-level-column");
    if (claimed) column.classList.add("complete");
    else if (current) column.classList.add("current");
    else column.classList.add("locked");
    if (reward.level === battlePassData.rewards.length) column.classList.add("final");

    column.append(makeElement("header", "", "Lv." + String(reward.level).padStart(2, "0")));
    const rewardCard = makeElement("div", "journey-tier-reward free");
    rewardCard.append(
      makeElement("i", "", reward.icon),
      makeElement("strong", "", localize(reward.name)),
      makeElement("small", "", claimed ? claimedRewardLabel() : "REWARD")
    );
    column.append(rewardCard);
    return column;
  }

  function renderRewards() {
    if (!battlePassData) return;
    const columns = battlePassData.rewards.map(reward => createRewardColumn(reward, battlePassData.player));
    rewardTrack.replaceChildren(...columns);
  }

  function renderPlayerData(data) {
    const player = data.player;
    document.querySelector(".journey-rank strong").textContent = String(player.passLevel).padStart(2, "0");
    document.querySelector(".journey-level-xp b").textContent =
      formatNumber(player.passXp) + " / " + formatNumber(player.passXpTarget);
    document.querySelector(".journey-level-xp i").style.setProperty(
      "--progress",
      clampPercent(player.passXp, player.passXpTarget) + "%"
    );
    document.querySelector(".journey-weekly b").textContent =
      formatNumber(player.weeklyXp) + " / " + formatNumber(player.weeklyXpTarget);
    document.querySelector(".journey-weekly i").style.setProperty(
      "--progress",
      clampPercent(player.weeklyXp, player.weeklyXpTarget) + "%"
    );
    document.querySelector(".journey-topbar > em").textContent = data.season.id;
    if (player.steamId) shell.dataset.steamId = player.steamId;
    else delete shell.dataset.steamId;
    renderMissions(activeFilter);
    renderRewards();
  }

  function setMissionFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach(button => {
      const active = button.dataset.missionFilter === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const strings = copy[getLanguage()] || copy.ko;
    [title.textContent, hint.textContent] = strings[filter];
    renderMissions(filter);
  }

  function authCopy() {
    const language = getLanguage();
    if (language === "ko") return { required: "Steam 로그인이 필요합니다", description: "SteamID로 내 배틀패스 진행도를 불러옵니다.", login: "Steam으로 로그인", loggedIn: "SteamID", logout: "로그아웃", error: "로그인 상태를 확인할 수 없습니다", retry: "잠시 후 새로고침해주세요." };
    return { required: "Steam sign-in required", description: "Sign in to load your battle pass progress.", login: "Sign in through Steam", loggedIn: "SteamID", logout: "Sign out", error: "Authentication is unavailable", retry: "Please refresh and try again." };
  }

  function showAuthGate(state, auth = null) {
    const strings = authCopy();
    shell.dataset.authState = state;
    loginButton.hidden = state !== "unauthenticated";
    if (state === "unauthenticated") {
      authGate.querySelector("strong").textContent = strings.required;
      authGate.querySelector("p").textContent = strings.description;
      loginButton.textContent = strings.login;
      loginButton.href = auth?.loginUrl || "./api/login.php?lang=" + encodeURIComponent(getLanguage());
      steamAccount.textContent = strings.required;
    } else if (state === "error") {
      authGate.querySelector("strong").textContent = strings.error;
      authGate.querySelector("p").textContent = strings.retry;
      steamAccount.textContent = "";
    }
  }

  function renderAuthenticatedAccount(auth) {
    const strings = authCopy();
    const label = makeElement("strong", "", strings.loggedIn + " " + auth.steamId);
    const form = document.createElement("form");
    form.method = "post";
    form.action = auth.logoutUrl;
    const token = document.createElement("input");
    token.type = "hidden";
    token.name = "csrf_token";
    token.value = auth.csrfToken;
    const button = makeElement("button", "", strings.logout);
    button.type = "submit";
    form.append(token, button);
    steamAccount.replaceChildren(label, form);
  }

  async function loadAuthentication() {
    try {
      const response = await fetch("./api/auth.php?lang=" + encodeURIComponent(getLanguage()), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const auth = await response.json();
      if (!auth.authenticated) {
        showAuthGate("unauthenticated", auth);
        document.documentElement.dataset.battlepassData = "unauthenticated";
        return;
      }
      renderAuthenticatedAccount(auth);
      shell.dataset.authState = "authenticated";
      await loadBattlePassData();
    } catch (error) {
      showAuthGate("error");
      document.documentElement.dataset.battlepassData = "error";
      console.warn("Steam authentication state could not be loaded.", error);
    }
  }
  async function loadBattlePassData(source = "./api/me.php?lang=" + encodeURIComponent(getLanguage())) {
    try {
      const response = await fetch(source, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data?.player || !data?.missions || !Array.isArray(data?.rewards)) {
        throw new Error("Invalid battle pass data");
      }
      battlePassData = data;
      renderPlayerData(data);
      document.documentElement.dataset.battlepassData = "loaded";
    } catch (error) {
      document.documentElement.dataset.battlepassData = "fallback";
      console.warn("Battle pass API data could not be loaded; using HTML fallback.", error);
    }
  }

  modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.journeyMode)));
  filterButtons.forEach(button => button.addEventListener("click", () => setMissionFilter(button.dataset.missionFilter)));
  document.querySelectorAll("[data-language]").forEach(button => {
    button.addEventListener("click", () => setTimeout(() => {
      setMissionFilter(activeFilter);
      renderRewards();
    }, 0));
  });

  rewardScroller?.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? rewardScroller.clientWidth
        : 1;
    const delta = event.deltaY * unit;
    const maxScroll = rewardScroller.scrollWidth - rewardScroller.clientWidth;
    const nextScroll = Math.max(0, Math.min(maxScroll, rewardScroller.scrollLeft + delta));

    if (nextScroll === rewardScroller.scrollLeft) return;
    event.preventDefault();
    rewardScroller.scrollLeft = nextScroll;
  }, { passive: false });

  setMode("rewards");
  setMissionFilter("daily");
  if (demoMode) {
    shell.dataset.authState = "authenticated";
    steamAccount.textContent = "UI DEMO";
    loadBattlePassData("./mock-player.json");
  } else {
    loadAuthentication();
  }
})();