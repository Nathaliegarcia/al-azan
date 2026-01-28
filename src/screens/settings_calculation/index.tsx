import {t} from '@lingui/macro';

import {
  FormControl,
  ScrollView,
  IScrollViewProps,
  Text,
  Button,
  Switch,
  Input,
  HStack,
  VStack,
  Spinner,
  Box,
} from 'native-base';
import {useCallback, useMemo, useState} from 'react';
import {useStore} from 'zustand';
import {CalcParamsBox} from './calc_params_box';
import {CalendarSettings} from './calendar_settings';
import {CalculationMethods} from '@/adhan';
import {CalculationMethodEntry} from '@/adhan/calculation_methods';
import {AutocompleteInput} from '@/components/AutocompleteInput';
import {SafeArea} from '@/components/safe_area';

import {push} from '@/navigation/root_navigation';
import {calcSettings, useCalcSettings} from '@/store/calculation';
import {clearMawaqitCache} from '@/store/mawaqit_cache';
import {clearCache as clearCalcCache} from '@/store/adhan_calc_cache';
import {
  fetchMawaqitPrayerTimesWithDetails,
  fetchMawaqitCalendar,
  storeMawaqitCalendar,
  MawaqitFetchResult,
} from '@/services/mawaqit_service';
import {ToastAndroid} from 'react-native';
import {getTime} from '@/utils/date';

export function CalculationSettings(props: IScrollViewProps) {
  const isMethodModified = useStore(
    calcSettings,
    s => s.computed.isCalcParamsModified,
  );

  const [calculationMethodKey, setCalculationMethodKey] = useCalcSettings(
    'CALCULATION_METHOD_KEY',
  );

  const [mawaqitEnabled, setMawaqitEnabled] = useCalcSettings('MAWAQIT_ENABLED');
  const [mawaqitUrl, setMawaqitUrl] = useCalcSettings('MAWAQIT_URL');
  const [mawaqitUrlInvalid, setMawaqitUrlInvalid] = useState(false);
  const [mawaqitTestLoading, setMawaqitTestLoading] = useState(false);
  const [mawaqitTestResult, setMawaqitTestResult] = useState<MawaqitFetchResult | null>(null);
  const [mawaqitCalendarLoading, setMawaqitCalendarLoading] = useState(false);

  const isValidMawaqitUrl = useCallback((url: string): boolean => {
    if (!url) return true; // Empty is valid (will disable Mawaqit)
    try {
      const urlObj = new URL(url);
      // Check if it's a mawaqit.net URL with a path (mosque identifier)
      return (
        urlObj.hostname.includes('mawaqit.net') &&
        urlObj.pathname.length > 1 // Has something after the initial /
      );
    } catch {
      return false;
    }
  }, []);

  const handleMawaqitEnabledChange = useCallback(
    (value: boolean) => {
      setMawaqitEnabled(value);
      // Clear both caches to force recalculation with new settings
      clearMawaqitCache();
      clearCalcCache();
      if (!value) {
        setMawaqitUrlInvalid(false);
      }
    },
    [setMawaqitEnabled],
  );

  const handleMawaqitUrlChange = useCallback(
    (value: string) => {
      const trimmedUrl = value.trim();
      setMawaqitUrl(trimmedUrl || undefined);

      // Validate URL format
      setMawaqitUrlInvalid(!isValidMawaqitUrl(trimmedUrl));

      // Clear both caches when URL changes to force re-fetch
      clearMawaqitCache();
      clearCalcCache();

      // Clear test result when URL changes
      setMawaqitTestResult(null);
    },
    [setMawaqitUrl, isValidMawaqitUrl],
  );

  const handleMawaqitTest = useCallback(async () => {
    if (!mawaqitUrl || mawaqitUrlInvalid) {
      setMawaqitTestResult({
        success: false,
        methodResults: [{method: 'iCal', success: false, error: t`Please enter a valid Mawaqit URL first`}],
      });
      return;
    }

    setMawaqitTestLoading(true);
    setMawaqitTestResult(null);

    try {
      const today = new Date();
      const result = await fetchMawaqitPrayerTimesWithDetails(mawaqitUrl, today);
      setMawaqitTestResult(result);
    } catch (error) {
      setMawaqitTestResult({
        success: false,
        methodResults: [{
          method: 'iCal',
          success: false,
          error: error instanceof Error ? error.message : t`Unknown error occurred`,
        }],
      });
    } finally {
      setMawaqitTestLoading(false);
    }
  }, [mawaqitUrl, mawaqitUrlInvalid]);

  const handleDownloadCalendar = useCallback(async () => {
    if (!mawaqitUrl) {
      return;
    }

    setMawaqitCalendarLoading(true);

    try {
      const result = await fetchMawaqitCalendar(mawaqitUrl);
      if (result.success && result.calendar) {
        storeMawaqitCalendar(result.calendar);
        ToastAndroid.show(t`Calendar downloaded successfully`, ToastAndroid.SHORT);
      } else {
        ToastAndroid.show(result.error || t`Failed to download calendar`, ToastAndroid.LONG);
      }
    } catch (error) {
      ToastAndroid.show(
        error instanceof Error ? error.message : t`Failed to download calendar`,
        ToastAndroid.LONG,
      );
    } finally {
      setMawaqitCalendarLoading(false);
    }
  }, [mawaqitUrl]);

  const getMethodLabel = useCallback(
    (entry: CalculationMethodEntry) => {
      if (isMethodModified && entry.key !== 'Custom') {
        return entry.label + ' (' + t`Modified` + ')';
      }
      return entry.label;
    },
    [isMethodModified],
  );

  const calculationMethodChanged = useCallback(
    (itemValue: CalculationMethodEntry) => {
      setCalculationMethodKey(itemValue.key);
      calcSettings.setState({
        FAJR_ADJUSTMENT: 0,
        SUNRISE_ADJUSTMENT: 0,
        DHUHR_ADJUSTMENT: 0,
        ASR_ADJUSTMENT: 0,
        MAGHRIB_ADJUSTMENT: 0,
        ISHA_ADJUSTMENT: 0,
        FAJR_ANGLE_OVERRIDE: undefined,
        ISHA_ANGLE_OVERRIDE: undefined,
        MAGHRIB_ANGLE_OVERRIDE: undefined,
        ISHA_INTERVAL_OVERRIDE: undefined,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const selectedMethod = useMemo(
    () =>
      calculationMethodKey
        ? CalculationMethods[calculationMethodKey]
        : undefined,
    [calculationMethodKey],
  );

  const calcMethods = useMemo(
    () =>
      Object.keys(CalculationMethods).map(key => {
        const method =
          CalculationMethods[key as keyof typeof CalculationMethods];
        method.key = key;
        return method;
      }),
    [],
  );

  const goToAdjustments = useCallback(() => {
    push('CalculationAdjustmentsSettings');
  }, []);

  const goToAdvancedSettings = useCallback(() => {
    push('CalculationAdvancedSettings');
  }, []);

  return (
    <SafeArea>
      <ScrollView
        p="4"
        _contentContainerStyle={{paddingBottom: 20}}
        keyboardShouldPersistTaps="handled"
        {...props}>
        <Text mb="5">{t`Calculating Adhan has many different methods. Each method provides different results. It is your responsibility to search and use the right method.`}</Text>
        <FormControl mb="5">
          <FormControl.Label m="0">{t`Calculation Method`}:</FormControl.Label>
          <AutocompleteInput<CalculationMethodEntry>
            actionsheetLabel={t`Calculation Method`}
            accessibilityLabel={t`Choose Calculation Method`}
            data={calcMethods}
            onItemSelected={calculationMethodChanged}
            autoCompleteKeys={['label']}
            getSelectedOptionLabel={getMethodLabel}
            selectedItem={selectedMethod}
            placeholder={t`Press to select a method`}
            errorMessage={t`Error in loading countries`}
          />
          {calculationMethodKey === 'UmmAlQura' && (
            <FormControl.HelperText>{t`30 minutes is added to Isha time during Ramadan in this method`}</FormControl.HelperText>
          )}
          {calculationMethodKey === 'Turkey' && (
            <FormControl.HelperText>{t`Diyanet method provided in Al-Azan is an approximation of the official times. Since there's not enough documentation available on how the times are exactly calculated, times may not align with the official website, especially out of Turkey.`}</FormControl.HelperText>
          )}
          <CalcParamsBox />
        </FormControl>

        <FormControl mb="5">
          <FormControl.Label m="0">{t`Mawaqit Integration`}</FormControl.Label>
          <VStack space={3}>
            <HStack alignItems="center" justifyContent="space-between">
              <Text flex={1}>{t`Use Mawaqit prayer times`}</Text>
              <Switch
                isChecked={mawaqitEnabled}
                onToggle={handleMawaqitEnabledChange}
                accessibilityLabel={t`Enable Mawaqit`}
              />
            </HStack>
            {mawaqitEnabled && (
              <VStack space={2}>
                <Input
                  placeholder={t`Mosque URL (e.g., https://mawaqit.net/fr/m/mosquee-de-frejus)`}
                  value={mawaqitUrl || ''}
                  onChangeText={handleMawaqitUrlChange}
                  accessibilityLabel={t`Mawaqit Mosque URL`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  isInvalid={mawaqitUrlInvalid && !!mawaqitUrl}
                />
                {mawaqitUrlInvalid && mawaqitUrl && (
                  <FormControl.ErrorMessage>
                    {t`Please enter a valid Mawaqit URL (e.g., https://mawaqit.net/fr/m/your-mosque)`}
                  </FormControl.ErrorMessage>
                )}
                <FormControl.HelperText>
                  {t`Enter your mosque URL from mawaqit.net. Prayer times will be fetched from Mawaqit. If the fetch fails, the app will use the selected calculation method as fallback and retry later.`}
                </FormControl.HelperText>
                <Button
                  mt="3"
                  onPress={handleMawaqitTest}
                  isDisabled={mawaqitTestLoading || !mawaqitUrl || mawaqitUrlInvalid}
                  leftIcon={mawaqitTestLoading ? <Spinner size="sm" color="white" /> : undefined}>
                  {mawaqitTestLoading ? t`Testing...` : t`Test Connection`}
                </Button>
                {mawaqitTestResult && (
                  <Box
                    mt="3"
                    p="3"
                    borderRadius="md"
                    bg={mawaqitTestResult.success ? 'green.100' : 'red.100'}
                    _dark={{
                      bg: mawaqitTestResult.success ? 'green.900' : 'red.900',
                    }}>
                    {mawaqitTestResult.success && mawaqitTestResult.times ? (
                      <VStack space={1}>
                        <Text
                          fontWeight="bold"
                          color="green.700"
                          _dark={{color: 'green.300'}}>
                          {t`Prayer times found via ${mawaqitTestResult.successMethod}:`}
                        </Text>
                        <Text>Fajr: {getTime(mawaqitTestResult.times.fajr)}</Text>
                        <Text>Sunrise: {getTime(mawaqitTestResult.times.sunrise)}</Text>
                        <Text>Dhuhr: {getTime(mawaqitTestResult.times.dhuhr)}</Text>
                        <Text>Asr: {getTime(mawaqitTestResult.times.asr)}</Text>
                        <Text>Maghrib: {getTime(mawaqitTestResult.times.maghrib)}</Text>
                        <Text>Isha: {getTime(mawaqitTestResult.times.isha)}</Text>
                      </VStack>
                    ) : (
                      <VStack space={2}>
                        <Text
                          fontWeight="bold"
                          color="red.700"
                          _dark={{color: 'red.300'}}>
                          {t`All fetch methods failed:`}
                        </Text>
                        {mawaqitTestResult.methodResults.map((result, index) => (
                          <Box key={index} pl="2">
                            <Text
                              fontWeight="semibold"
                              color="red.600"
                              _dark={{color: 'red.400'}}>
                              {result.method}:
                            </Text>
                            <Text
                              fontSize="sm"
                              color="red.600"
                              _dark={{color: 'red.400'}}
                              pl="2">
                              {result.error || t`Unknown error`}
                            </Text>
                          </Box>
                        ))}
                      </VStack>
                    )}
                  </Box>
                )}
                {mawaqitTestResult?.success && (
                  <Button
                    mt="3"
                    variant="outline"
                    onPress={handleDownloadCalendar}
                    isDisabled={mawaqitCalendarLoading}
                    leftIcon={mawaqitCalendarLoading ? <Spinner size="sm" /> : undefined}>
                    {mawaqitCalendarLoading ? t`Downloading...` : t`Download Full Calendar`}
                  </Button>
                )}
              </VStack>
            )}
          </VStack>
        </FormControl>

        <CalendarSettings mb="7" />

        <Button mb="5" onPress={goToAdjustments}>{t`Adjustments`}</Button>

        <Button
          mb="5"
          onPress={
            goToAdvancedSettings
          }>{t`Advanced Calculation Settings`}</Button>
      </ScrollView>
    </SafeArea>
  );
}
