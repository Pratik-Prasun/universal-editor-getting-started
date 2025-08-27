/* eslint-disable no-alert */
/* eslint-disable no-console */

// Survey constants
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
  JSON_EXTENSION: 'json',
};

// Validation helper function
function isAnswerRequired(question) {
  return question.Mandatory === SURVEY_CONSTANTS.MANDATORY_TRUE
    && question.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE;
}

function hasValidAnswer(question, answers) {
  return answers[question.ContentId] != null;
}

// Simple function to fetch survey data using the exact same logic as customform.js
async function fetchSurveyData(surveyHref) {
  let mapping = surveyHref;
  if (!surveyHref.endsWith('json')) {
    const mappingresp = await fetch('/paths.json');
    const mappingData = await mappingresp.json();
    const mappingEntries = Object.entries(mappingData.mappings);
    const foundMapping = mappingEntries.find(([, value]) => {
      const [before] = value.split(':');
      return before === surveyHref;
    });
    if (foundMapping) {
      const [, after] = foundMapping[1].split(':');
      mapping = after;
    }
  }
  const resp = await fetch(mapping);
  const json = await resp.json();
  return json;
}

// Parse survey data from JSON response
function parseSurveyData(surveyResponse) {
  // API consistently returns {data: [...], total, offset, limit} format
  const questions = surveyResponse.data || [];

  // However, Options field may sometimes be converted to comma-separated strings
  // during Excel/AEM processing, so we need to normalize it back to arrays
  const normalizedQuestions = questions.map((item) => {
    // Ensure Options is always an array
    if (item.Options && typeof item.Options === 'string') {
      item.Options = item.Options.split(',').map((opt) => opt.trim());
    }
    return item;
  });

  // Sort by Order column
  return normalizedQuestions.sort((a, b) => parseInt(a.Order, 10) - parseInt(b.Order, 10));
}

// Calculate progress for survey questions
function calculateProgress(currentIndex, surveyData) {
  // Calculate progress based on CountsAsQuestion
  const actualQuestions = surveyData.filter((q) => q.CountsAsQuestion === 'TRUE');
  const totalActualQuestions = actualQuestions.length;

  // Count how many actual questions have been completed up to current index
  let questionsCompleted = 0;
  for (let i = 0; i <= currentIndex; i += 1) {
    if (surveyData[i].CountsAsQuestion === 'TRUE') {
      questionsCompleted += 1;
    }
  }

  const progress = (questionsCompleted / totalActualQuestions) * 100;
  return { progress, questionsCompleted, totalActualQuestions };
}

// Render shared survey template
function renderSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentHTML,
) {
  return `
    <div class="survey-form">
      <!-- Progress -->
      <div class="progress">
        <div class="progress-track">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-counter">${questionsCompleted}/${totalActualQuestions}</div>
      </div>
      <!-- Content -->
      <div class="content">
        <span class="section-title">${section}</span>
        
        <div class="question-icon">${icon}</div>
        
        ${contentHTML}
        
        <!-- Navigation -->
        <div class="nav">
          <button type="button" class="btn-back">Back</button>
          <button type="button" class="btn-next">Next</button>
        </div>
      </div>
    </div>
  `;
}

function renderFactContent(questionData, currentIndex, surveyData) {
  const {
    Section, Icon, Title, Question,
  } = questionData;

  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );

  const contentHTML = `
    <h1 class="title">${Title}</h1>
    <p class="fact-content">${Question}</p>
  `;

  return renderSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentHTML,
  );
}

// Render different question types
function renderQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Section, Icon, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === SURVEY_CONSTANTS.FACT_TYPE) {
    return renderFactContent(questionData, currentIndex, surveyData);
  }

  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );

  let optionsHTML = '';

  if (OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
    optionsHTML = Options.map((option) => `
      <div class="option">
        <input type="radio" id="${ContentId}-${option.replace(/\s+/g, '-').toLowerCase()}" 
               name="${ContentId}" value="${option}">
        <label for="${ContentId}-${option.replace(/\s+/g, '-').toLowerCase()}">${option}</label>
      </div>
    `).join('');
  } else if (OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
    optionsHTML = `
      <div class="slider-container">
        <div class="slider-labels">
          ${Options.map((option) => `<span>${option}</span>`).join('')}
        </div>
        <input type="range" id="${ContentId}" name="${ContentId}" 
               min="0" max="${Options.length - 1}" value="0" 
               class="slider" data-options='${JSON.stringify(Options)}'>
        <div class="slider-value">${Options[0]}</div>
      </div>
    `;
  }

  const contentHTML = `
    ${Title ? `<h1 class="title">${Title}</h1>` : ''}
    <h2 class="question">${Question}</h2>
    
    <div class="options">
      ${optionsHTML}
    </div>
  `;

  return renderSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentHTML,
  );
}

export default function decorate(block) {
  if (!block) return;

  // prevent running twice on the same block
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  // capture the top-level divs
  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // create a survey-area wrapper if missing
  if (!surveyArea && (logo || content)) {
    surveyArea = document.createElement('div');
    block.prepend(surveyArea);
  }

  // apply the survey-area class
  if (surveyArea) surveyArea.classList.add('survey-area');

  // handle background picture → CSS background
  const bgWrapper = surveyArea?.querySelector(':scope > div:first-child');
  const pic = bgWrapper?.querySelector('picture');
  const img = pic?.querySelector('img');

  if (pic && img && surveyArea) {
    const applyBackgroundAndRemove = () => {
      if (img.currentSrc) {
        surveyArea.style.backgroundImage = `url(${img.currentSrc})`;
        surveyArea.classList.add('has-background');
      }
      if (bgWrapper && bgWrapper.parentElement) {
        bgWrapper.parentElement.removeChild(bgWrapper);
      } else if (pic.parentElement) {
        pic.parentElement.removeChild(pic);
      }
    };

    if (img.currentSrc) {
      img.decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener('load', () => {
        img.decode()
          .then(applyBackgroundAndRemove)
          .catch(applyBackgroundAndRemove);
      }, { once: true });
    }
  }

  // move nodes in their original order
  if (logo) {
    logo.classList.add('logo');
    if (surveyArea && logo.parentElement !== surveyArea) {
      surveyArea.appendChild(logo);
    }
  }

  if (content) {
    content.classList.add('content');
    if (surveyArea && content.parentElement !== surveyArea) {
      surveyArea.appendChild(content);
    }
  }

  // Convert button paragraph to div
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = document.createElement('div');
    div.className = buttonContainer.className;
    div.innerHTML = buttonContainer.innerHTML;
    buttonContainer.parentNode.replaceChild(div, buttonContainer);
  }

  // Survey state management
  let surveyData = [];
  let currentQuestionIndex = 0;
  let surveyAnswers = {};
  let originalContent = '';

  // Function to navigate to specific question
  function showQuestion(index) {
    currentQuestionIndex = index;
    const questionData = surveyData[index];

    const questionHTML = renderQuestion(questionData, index, surveyData);
    surveyArea.innerHTML = questionHTML;

    // Attach event listeners
    // eslint-disable-next-line no-use-before-define
    attachNavigationListeners();
    // eslint-disable-next-line no-use-before-define
    attachInputListeners();
  }

  // Function to attach Get Started button listener
  function attachGetStartedListener() {
    const getStartedButton = surveyArea.querySelector('.button-container .button');
    if (getStartedButton) {
      getStartedButton.addEventListener('click', async (e) => {
        e.preventDefault();

        const surveyDataPath = getStartedButton.getAttribute('href');

        try {
          // Store original content
          originalContent = surveyArea.innerHTML;

          // Fetch and parse survey data
          const data = await fetchSurveyData(surveyDataPath);
          console.log('Survey data loaded:', data);

          // Assuming the data is CSV format, parse it
          surveyData = parseSurveyData(data);
          console.log('Parsed survey questions:', surveyData);

          // Start survey
          currentQuestionIndex = 0;
          surveyAnswers = {};
          showQuestion(0);
        } catch (error) {
          console.error('Failed to load survey data:', error);
          alert('Failed to load survey. Please try again.');
        }
      });
    }
  }

  // Attach input event listeners
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      const slider = surveyArea.querySelector('.slider');
      const valueDisplay = surveyArea.querySelector('.slider-value');

      if (slider && valueDisplay) {
        const options = JSON.parse(slider.dataset.options);

        slider.addEventListener('input', (e) => {
          const selectedIndex = parseInt(e.target.value, 10);
          valueDisplay.textContent = options[selectedIndex];
          surveyAnswers[currentQuestion.ContentId] = options[selectedIndex];
        });

        // Set initial value if answer exists
        if (surveyAnswers[currentQuestion.ContentId]) {
          const answerIndex = options.indexOf(surveyAnswers[currentQuestion.ContentId]);
          if (answerIndex !== -1) {
            slider.value = answerIndex;
            valueDisplay.textContent = options[answerIndex];
          }
        }
      }
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      const radioButtons = surveyArea.querySelectorAll(`input[name="${currentQuestion.ContentId}"]`);

      radioButtons.forEach((radio) => {
        radio.addEventListener('change', (e) => {
          surveyAnswers[currentQuestion.ContentId] = e.target.value;
        });

        // Restore previous answer
        if (surveyAnswers[currentQuestion.ContentId] === radio.value) {
          radio.checked = true;
        }
      });
    }
  }

  // Attach navigation event listeners
  function attachNavigationListeners() {
    const backButton = surveyArea.querySelector('.btn-back');
    const nextButton = surveyArea.querySelector('.btn-next');

    if (backButton) {
      backButton.addEventListener('click', () => {
        // Emit custom event instead of direct function call
        surveyArea.dispatchEvent(new CustomEvent('survey:back'));
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', () => {
        const currentQuestion = surveyData[currentQuestionIndex];

        // Validate mandatory fields using helper functions
        if (isAnswerRequired(currentQuestion) && !hasValidAnswer(currentQuestion, surveyAnswers)) {
          alert('Please select an option before continuing.');
          return;
        }

        // Emit custom event instead of direct function call
        surveyArea.dispatchEvent(new CustomEvent('survey:next'));
      });
    }
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        showQuestion(currentQuestionIndex - 1);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', () => {
      if (currentQuestionIndex < surveyData.length - 1) {
        showQuestion(currentQuestionIndex + 1);
      } else {
        // Survey complete
        console.log('Survey completed:', surveyAnswers);
        alert('Survey completed! Check console for answers.');
      }
    });
  }

  // Initialize Get Started button
  if (surveyArea) {
    attachGetStartedListener();
  }

  if (footer) footer.classList.add('footer-content');
}
