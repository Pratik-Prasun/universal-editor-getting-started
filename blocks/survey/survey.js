/* eslint-disable no-alert */
/* eslint-disable no-console */

/**
 * Survey Block - Interactive Survey Component for AEM Edge Delivery Services
 *
 * This module handles dynamic survey rendering with support for:
 * - Multiple question types (radio, slider, fact cards)
 * - Progress tracking and navigation
 * - Related question grouping
 * - Secure DOM manipulation without innerHTML risks
 */

// Survey configuration constants
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
  JSON_EXTENSION: 'json',
};

/**
 * Validates whether a survey question requires an answer before proceeding.
 * Combines both mandatory flag and question type to determine requirement.
 */
function isAnswerRequired(question) {
  return question.Mandatory === SURVEY_CONSTANTS.MANDATORY_TRUE
    && question.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE;
}

/**
 * Checks if the user has provided a valid answer for a given question.
 * Handles both null and undefined values as invalid answers.
 */
function hasValidAnswer(question, answers) {
  return answers[question.ContentId] != null;
}

// Find all related questions starting from a given index (q5a, q5b, q5c, etc.)
function findRelatedQuestions(surveyData, startIndex) {
  const relatedQuestions = [surveyData[startIndex]];
  const baseId = surveyData[startIndex].ContentId.replace(/[a-z]$/, '');

  // Only consider it a group if the base ID is different from the original (has letter suffix)
  if (baseId === surveyData[startIndex].ContentId) {
    return relatedQuestions; // Single question, no related ones
  }

  // Look for subsequent questions with the same base ID
  for (let i = startIndex + 1; i < surveyData.length; i += 1) {
    const currentQuestion = surveyData[i];
    const currentBaseId = currentQuestion.ContentId.replace(/[a-z]$/, '');

    if (currentBaseId === baseId && currentBaseId !== currentQuestion.ContentId) {
      relatedQuestions.push(currentQuestion);
    } else {
      break; // Stop when we find a question that doesn't belong to this group
    }
  }

  return relatedQuestions;
}

// Create DOM elements safely without innerHTML to prevent XSS
function createElement(tag, className, textContent, attributes = {}) {
  const element = document.createElement(tag);
  if (className) element.classList.add(...className.split(' '));
  if (textContent) element.textContent = textContent;

  Object.entries(attributes).forEach(([key, value]) => {
    if (key.startsWith('data-')) {
      element.dataset[key.replace('data-', '')] = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  return element;
}

// Safely replace all content in a container
function replaceContent(container, newContent) {
  // Clear existing content safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Add new content
  if (typeof newContent === 'string') {
    container.textContent = newContent;
  } else if (newContent) {
    container.appendChild(newContent);
  }
}

// Create radio button options for multiple choice questions
function createRadioOptions(contentId, options) {
  const container = createElement('div', 'options');

  options.forEach((option) => {
    const optionDiv = createElement('div', 'option');

    const input = createElement('input', '', '', {
      type: 'radio',
      id: `${contentId}-${option.replace(/\s+/g, '-').toLowerCase()}`,
      name: contentId,
      value: option,
    });

    const label = createElement('label', '', option, {
      for: input.id,
    });

    optionDiv.appendChild(input);
    optionDiv.appendChild(label);
    container.appendChild(optionDiv);
  });

  return container;
}

// Create slider with labeled options (for rating scales)
function createSlider(contentId, options, questionText = '') {
  const container = createElement('div', 'slider-container');

  if (questionText) {
    const questionH3 = createElement('h3', 'slider-question', questionText);
    container.appendChild(questionH3);
  }

  const labelsDiv = createElement('div', 'slider-labels');
  options.forEach((option) => {
    const span = createElement('span', '', option);
    labelsDiv.appendChild(span);
  });

  const slider = createElement('input', 'slider', '', {
    type: 'range',
    id: contentId,
    name: contentId,
    min: '0',
    max: String(options.length - 1),
    value: '0',
    'data-options': JSON.stringify(options),
  });

  const valueDiv = createElement('div', 'slider-value', options[0]);

  container.appendChild(labelsDiv);
  container.appendChild(slider);
  container.appendChild(valueDiv);

  return container;
}

// Fetch survey data - handles both direct JSON URLs and path mappings
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

// Parse and normalize survey data from API response
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

// Calculate survey progress based on completed questions
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

// Build the main survey template with progress bar and navigation
function createSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentElement,
) {
  const surveyForm = createElement('div', 'survey-form');

  // Create progress section
  const progressDiv = createElement('div', 'progress');
  const progressTrack = createElement('div', 'progress-track');
  const progressFill = createElement('div', 'progress-fill');
  progressFill.style.width = `${progress}%`;
  const progressCounter = createElement('div', 'progress-counter', `${questionsCompleted}/${totalActualQuestions}`);

  progressTrack.appendChild(progressFill);
  progressDiv.appendChild(progressTrack);
  progressDiv.appendChild(progressCounter);

  // Create content section
  const contentDiv = createElement('div', 'content');
  const sectionTitle = createElement('span', 'section-title', section);
  const questionIcon = createElement('div', 'question-icon', icon);

  contentDiv.appendChild(sectionTitle);
  contentDiv.appendChild(questionIcon);
  contentDiv.appendChild(contentElement);

  // Create navigation
  const navDiv = createElement('div', 'nav');
  const backBtn = createElement('button', 'btn-back', 'Back', { type: 'button' });
  const nextBtn = createElement('button', 'btn-next', 'Next', { type: 'button' });

  navDiv.appendChild(backBtn);
  navDiv.appendChild(nextBtn);
  contentDiv.appendChild(navDiv);

  surveyForm.appendChild(progressDiv);
  surveyForm.appendChild(contentDiv);

  return surveyForm;
}

// Create fact/information slides (non-interactive content)
function createFactContent(questionData, currentIndex, surveyData) {
  const {
    Section, Icon, Title, Question,
  } = questionData;

  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );

  const contentElement = createElement('div');
  const titleH1 = createElement('h1', 'title', Title);
  const factP = createElement('p', 'fact-content', Question);

  contentElement.appendChild(titleH1);
  contentElement.appendChild(factP);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Build interactive question slides (radio buttons, sliders, etc.)
function createQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Section, Icon, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === SURVEY_CONSTANTS.FACT_TYPE) {
    return createFactContent(questionData, currentIndex, surveyData);
  }

  // Find all related questions (q5a, q5b, q5c, etc.)
  const relatedQuestions = findRelatedQuestions(surveyData, currentIndex);
  const hasMultipleQuestions = relatedQuestions.length > 1;

  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );

  const contentElement = createElement('div');

  // Add title if present
  if (Title) {
    const titleH1 = createElement('h1', 'title', Title);
    contentElement.appendChild(titleH1);
  }

  // Add main question text (unless it's multiple slider questions where each has its own text)
  if (!(hasMultipleQuestions && OptionType === SURVEY_CONSTANTS.SLIDER_TYPE)) {
    const questionH2 = createElement('h2', 'question', Question);
    contentElement.appendChild(questionH2);
  }

  // Create options container
  const optionsDiv = createElement('div', 'options');

  if (OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
    // For radio buttons, only use the first question (no grouping for radio)
    const radioOptions = createRadioOptions(ContentId, Options);
    optionsDiv.appendChild(radioOptions);
  } else if (OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
    if (hasMultipleQuestions) {
      // Create multiple related sliders dynamically
      relatedQuestions.forEach((relatedQuestion) => {
        const slider = createSlider(
          relatedQuestion.ContentId,
          relatedQuestion.Options,
          relatedQuestion.Question,
        );
        optionsDiv.appendChild(slider);
      });
    } else {
      // Single slider
      const slider = createSlider(ContentId, Options);
      optionsDiv.appendChild(slider);
    }
  }

  contentElement.appendChild(optionsDiv);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
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
    surveyArea = createElement('div');
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

  // Convert button paragraph to div using consistent approach
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = createElement('div');
    div.className = buttonContainer.className; // Keep existing classes intact
    // Copy all child nodes safely
    while (buttonContainer.firstChild) {
      div.appendChild(buttonContainer.firstChild);
    }
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

    const questionElement = createQuestion(questionData, index, surveyData);

    // Preserve the original container structure and styling
    surveyArea.className = 'survey-area';
    replaceContent(surveyArea, questionElement);

    // Attach event listeners
    // eslint-disable-next-line no-use-before-define
    attachNavigationListeners();
    // eslint-disable-next-line no-use-before-define
    attachInputListeners();
  }

  // Handle Get Started button click
  async function handleGetStartedClick(e) {
    e.preventDefault();

    const surveyDataPath = e.target.getAttribute('href');

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
  }

  // Function to attach Get Started button listener
  function attachGetStartedListener() {
    // Cache DOM query
    const getStartedButton = surveyArea.querySelector('.button-container .button');
    if (getStartedButton) {
      getStartedButton.addEventListener('click', handleGetStartedClick);
    }
  }

  // Handle slider input change
  function handleSliderInput(e, options, questionId, valueDisplay) {
    const selectedIndex = parseInt(e.target.value, 10);
    valueDisplay.textContent = options[selectedIndex];
    surveyAnswers[questionId] = options[selectedIndex];
  }

  // Handle radio button change
  function handleRadioChange(e, questionId) {
    surveyAnswers[questionId] = e.target.value;
  }

  // Attach input event listeners
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];
    const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      // Handle all sliders (single or multiple related questions)
      const sliders = surveyArea.querySelectorAll('.slider');

      sliders.forEach((slider, index) => {
        const valueDisplay = slider.parentElement.querySelector('.slider-value');
        const questionData = relatedQuestions[index]; // Dynamic mapping based on related questions
        const options = JSON.parse(slider.dataset.options);

        slider.addEventListener('input', (e) => {
          handleSliderInput(e, options, questionData.ContentId, valueDisplay);
        });

        // Set initial value if answer exists, otherwise set default value
        if (surveyAnswers[questionData.ContentId]) {
          const answerIndex = options.indexOf(surveyAnswers[questionData.ContentId]);
          if (answerIndex !== -1) {
            slider.value = answerIndex;
            valueDisplay.textContent = options[answerIndex];
          }
        } else {
          // Initialize with default slider value (first option)
          const defaultIndex = parseInt(slider.value, 10);
          surveyAnswers[questionData.ContentId] = options[defaultIndex];
        }
      });
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      // Cache DOM query
      const radioButtons = surveyArea.querySelectorAll(`input[name="${currentQuestion.ContentId}"]`);

      radioButtons.forEach((radio) => {
        // Use extracted handler function
        radio.addEventListener('change', (e) => {
          handleRadioChange(e, currentQuestion.ContentId);
        });

        // Restore previous answer
        if (surveyAnswers[currentQuestion.ContentId] === radio.value) {
          radio.checked = true;
        }
      });
    }
  }

  // Handle back button click
  function handleBackClick() {
    // Emit custom event instead of direct function call
    surveyArea.dispatchEvent(new CustomEvent('survey:back'));
  }

  // Handle next button click
  function handleNextClick() {
    const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);

    // Validate mandatory fields for all related questions displayed
    const hasInvalidQuestion = relatedQuestions.some((question) => {
      const isRequired = isAnswerRequired(question);
      const hasAnswer = hasValidAnswer(question, surveyAnswers);
      return isRequired && !hasAnswer;
    });

    if (hasInvalidQuestion) {
      const questionCount = relatedQuestions.length;
      const message = questionCount > 1
        ? `Please select an option for all ${questionCount} questions before continuing.`
        : 'Please select an option before continuing.';
      alert(message);
      return;
    }

    // Emit custom event instead of direct function call
    surveyArea.dispatchEvent(new CustomEvent('survey:next'));
  }

  // Attach navigation event listeners
  function attachNavigationListeners() {
    // Cache DOM queries
    const backButton = surveyArea.querySelector('.btn-back');
    const nextButton = surveyArea.querySelector('.btn-next');

    if (backButton) {
      backButton.addEventListener('click', handleBackClick);
    }

    if (nextButton) {
      nextButton.addEventListener('click', handleNextClick);
    }
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content (trusted content, can use innerHTML)
        replaceContent(surveyArea);
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        // Find the start of the previous question group
        let prevIndex = currentQuestionIndex - 1;

        // Get the base ID of the question we're backing to
        const targetQuestion = surveyData[prevIndex];
        const targetBaseId = targetQuestion.ContentId.replace(/[a-z]$/, '');

        // If it's a grouped question (has letter suffix), find the first in the group
        if (targetBaseId !== targetQuestion.ContentId) {
          // Keep going back to find the first question in this group (q5a, not q5b or q5c)
          while (prevIndex > 0) {
            const currentQ = surveyData[prevIndex];
            const baseId = currentQ.ContentId.replace(/[a-z]$/, '');

            // Check if the previous question also belongs to the same group
            if (prevIndex > 0) {
              const prevQ = surveyData[prevIndex - 1];
              const prevBaseId = prevQ.ContentId.replace(/[a-z]$/, '');

              // If previous question has same base ID, keep going back
              if (prevBaseId === baseId && prevBaseId !== prevQ.ContentId) {
                prevIndex -= 1;
              } else {
                break; // Found the start of the group
              }
            } else {
              break; // We're at index 0
            }
          }
        }

        showQuestion(prevIndex);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', () => {
      const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);
      // Skip additional related questions since they were displayed together
      const questionsToSkip = relatedQuestions.length - 1;

      const nextIndex = currentQuestionIndex + 1 + questionsToSkip;

      if (nextIndex < surveyData.length) {
        showQuestion(nextIndex);
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
